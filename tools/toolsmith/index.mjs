#!/usr/bin/env node
// toolsmith — scaffold, verify and seal Ryu plugin tools.
//
//   node tools/toolsmith/index.mjs scaffold --id @scope/name --tool slug [--kind inline_tool|adapter] [--out DIR]
//   node tools/toolsmith/index.mjs verify   <plugin dir>
//   node tools/toolsmith/index.mjs sync     <plugin dir> [--check]
//
// `verify` is the gate: purity scan → manifest contract → drift check → golden
// cases. A tool that has not passed it is not a tool, it is a draft. The same four
// checks also run inside the generated `tool.test.mjs` (see `harness.mjs`), so the
// automated suite cannot be greener than this command. `README.md` has the
// contract; `.claude/skills/tool-maker/SKILL.md` has the procedure.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
	checkBodyDrift,
	checkManifestContract,
	findManifestSeat,
} from "./manifest.mjs";
import { formatViolations, scanPurity } from "./purity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

// ── argument parsing ─────────────────────────────────────────────────────────

/** Parse `--flag value` / `--flag` pairs plus positional arguments. */
function parseArgs(argv) {
	const flags = {};
	const positional = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const next = argv[i + 1];
			if (next === undefined || next.startsWith("--")) {
				flags[key] = true;
			} else {
				flags[key] = next;
				i++;
			}
		} else {
			positional.push(arg);
		}
	}
	return { flags, positional };
}

function die(message) {
	process.stderr.write(`toolsmith: ${message}\n`);
	process.exit(1);
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		die(`${path}: ${err.message}`);
	}
}

/**
 * Write JSON in the style Biome formats this repo's manifests in — two spaces,
 * trailing newline — so a scaffolded package is not reformatted the first time
 * anyone runs `ultracite fix` (which would then look like drift in `sync --check`).
 */
function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Write a file only when it does not already exist, and say which happened.
 *
 * Used for the AUTHORED files (`tools|adapters/<slug>.js`, `cases.json`). There is
 * deliberately no flag that overrides this: a `--force` that overwrote everything
 * destroyed a finished body and its case table during development, and "the
 * scaffolder ate my work" is not a failure mode worth keeping a flag for. To start
 * over, delete the file.
 */
function writeIfAbsent(path, contents) {
	if (existsSync(path)) {
		process.stdout.write(`toolsmith: kept existing ${path}\n`);
		return;
	}
	writeFileSync(path, contents);
}

// ── shared: locate the tool body a plugin dir declares ───────────────────────

/**
 * Resolve the single tool a plugin directory's `cases.json` describes.
 *
 * `cases.json` is the toolsmith-side source of truth for WHICH body is under
 * test, deliberately separate from the manifest: an adapter names its body with
 * `code_file` (which Core hydrates) while an `inline_deno` tool has no
 * `code_file` field at all in `ToolConfig` and must carry its body inline. One
 * pointer that works for both keeps the harness from having to branch on kind
 * just to find the file.
 */
function loadToolPackage(dir) {
	const casesPath = join(dir, "cases.json");
	if (!existsSync(casesPath)) {
		die(
			`${dir} has no cases.json — this is not a toolsmith package. Run \`scaffold\` first.`
		);
	}
	const spec = readJson(casesPath);
	const kind = spec.kind ?? "inline_tool";
	if (!spec.code_file) {
		die(`${casesPath} does not name a code_file`);
	}
	const codePath = join(dir, spec.code_file);
	if (!existsSync(codePath)) {
		die(`${casesPath} points at ${spec.code_file}, which does not exist`);
	}
	return { spec, kind, codePath, code: readFileSync(codePath, "utf8") };
}

/**
 * `findManifestSeat` throws on a package with no manifest — right for the test
 * harness (a broken package should fail the suite with a stack), wrong for a CLI,
 * where it would print a Node stack trace instead of the one-line reason.
 */
function seatOrDie(dir, spec, kind) {
	try {
		return findManifestSeat(dir, spec, kind);
	} catch (err) {
		return die(err.message);
	}
}

// ── scaffold ─────────────────────────────────────────────────────────────────

const INLINE_TOOL_TEMPLATE = (
	slug
) => `// Tool body for \`${slug}\`, run in Core's Deno sandbox.
//
// This file is a FRAGMENT, not an ES module: Core splices it into an async IIFE
// with \`input\` (the call arguments) and \`host\` (the capability bridge) already
// bound, and the body \`return\`s the tool's result. A top-level \`return\` is
// therefore correct here and \`export\` is not.
//
// It must be a PURE function of \`input\` plus whatever \`host.*\` returns: no
// \`Date.now()\`, no \`Math.random()\`, no ambient clock or environment. Everything
// variable arrives as an argument. \`node tools/toolsmith/index.mjs verify\`
// enforces that both statically and by running every case twice.

if (typeof input.text !== "string" || input.text.length === 0) {
	throw new Error("${slug}: 'text' is required and must be a non-empty string");
}

return { length: input.text.length };
`;

const ADAPTER_TEMPLATE = (
	verb
) => `// Capability adapter for \`${verb}\`, run in Core's plugin sandbox.
//
// Injected globals: \`input\` (canonical verb args), \`defaults\` (the provider's
// resolved arg_defaults), \`callTool(args)\` (the manifest-fixed provider tool) and
// \`callNamed(id, args)\` (one of the extra tools \`adapter.tools\` declared).
//
// This file is a FRAGMENT, not an ES module: Core splices it into an async IIFE
// and it \`return\`s the canonical result. That is why a top-level \`return\` is
// correct here, and why plugins-store/*/adapters is excluded from Biome.
//
// It must be a PURE function of \`input\`/\`defaults\` and the provider's answers:
// the ONLY nondeterminism a verified adapter may contain is the provider call
// itself. \`node tools/toolsmith/index.mjs verify\` enforces that.

const res = await callTool({ query: input.query });
// An MCP \`tools/call\` answer is the TRANSPORT envelope, not the tool's value.
// Only \`structuredContent\` carries the typed model; shaping a missing one into an
// empty result would report a broken install as "nothing found".
const payload = res && res.structuredContent;
if (!payload || res.isError) {
	return { raw: res };
}

return { results: payload.results ?? [] };
`;

const CASES_TEMPLATE = (slug, kind, codeFile) => {
	const base = { tool: slug, kind, code_file: codeFile };
	if (kind === "adapter") {
		return {
			...base,
			adapter_tools: [],
			cases: [
				{
					name: "maps a provider hit onto the canonical shape",
					input: { query: "lisbon" },
					provider: {
						call: [
							{
								structuredContent: {
									results: [{ url: "https://example.com" }],
								},
							},
						],
					},
					expect: { results: [{ url: "https://example.com" }] },
					expectCalls: [{ path: "callTool", args: { query: "lisbon" } }],
				},
				{
					name: "an empty provider result stays empty, not null",
					input: { query: "nothing" },
					provider: { call: [{ structuredContent: {} }] },
					expect: { results: [] },
				},
				{
					name: "a broken provider passes the envelope through instead of faking a result",
					input: { query: "lisbon" },
					provider: { call: [{ isError: true, content: [] }] },
					expect: { raw: { isError: true, content: [] } },
				},
			],
		};
	}
	return {
		...base,
		cases: [
			{
				name: "counts the characters of a normal string",
				input: { text: "hello" },
				expect: { length: 5 },
			},
			{
				name: "a multi-byte string counts UTF-16 code units, not bytes",
				input: { text: "héllo" },
				expect: { length: 5 },
			},
			{
				name: "rejects a missing text field instead of returning zero",
				input: {},
				expectError: "'text' is required",
			},
		],
	};
};

const TEST_TEMPLATE = (
	harnessSpecifier
) => `// Generated by \`tools/toolsmith\`. Runs this package's tool body against every
// case in \`cases.json\`, twice each, with all ambient nondeterminism shadowed.
//
// Re-running \`scaffold\` regenerates this file; it never touches the body or
// \`cases.json\`. Add cases by editing \`cases.json\`, never by editing this file.

import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Dynamic, because a published satellite tree ships the plugin without the repo's
// tools/ directory — there the harness is genuinely absent and a skip is the honest
// result. A REPORTED skip, never a silent pass: a suite that quietly tests nothing
// is the failure mode this whole pipeline exists to prevent.
let defineToolTests;
try {
	({ defineToolTests } = await import("${harnessSpecifier}"));
} catch {
	test("toolsmith harness is absent — cases did NOT run (satellite checkout?)", {
		skip: "harness not resolvable from this tree",
	}, () => {
		// intentionally empty: the skip reason is the report
	});
}

if (defineToolTests) {
	defineToolTests(here);
}
`;

function scaffold(flags) {
	const id = flags.id;
	const slug = flags.tool;
	const kind = flags.kind ?? "inline_tool";
	if (!(id && slug)) {
		die("scaffold requires --id <@scope/name> and --tool <slug>");
	}
	if (!(kind === "inline_tool" || kind === "adapter")) {
		die(`--kind must be inline_tool or adapter, got '${kind}'`);
	}
	if (!/^[a-z0-9][a-z0-9_.-]*$/.test(slug)) {
		die(
			`--tool '${slug}' must match [a-z0-9][a-z0-9_.-]* (it becomes the callable id app__${slug})`
		);
	}

	const dirName = basename(id);
	const outDir = flags.out
		? resolve(String(flags.out))
		: join(REPO_ROOT, "plugins-store", dirName);

	// `adapters/` is one of Core's two CODE_FILE_DIRS, so an adapter body can be a
	// real `code_file` the loader hydrates. `tools/` is NOT (ToolConfig has no
	// code_file field at all), so an inline_deno body lives in a file for
	// authorship and diffability and is SEALED into the manifest by `sync`.
	const codeFile =
		kind === "adapter" ? `adapters/${slug}.js` : `tools/${slug}.js`;
	const codePath = join(outDir, codeFile);

	mkdirSync(dirname(codePath), { recursive: true });

	// Re-scaffolding regenerates the GENERATED file and nothing else. The body and
	// the case table are authored — the only record of what the tool is supposed to
	// do — so running `scaffold` again over an existing package must never silently
	// replace them. `tool.test.mjs` carries no author intent and is rewritten every
	// time on purpose.
	const casesPath = join(outDir, "cases.json");
	writeIfAbsent(
		codePath,
		kind === "adapter" ? ADAPTER_TEMPLATE(slug) : INLINE_TOOL_TEMPLATE(slug)
	);
	writeIfAbsent(
		casesPath,
		`${JSON.stringify(CASES_TEMPLATE(slug, kind, codeFile), null, 2)}\n`
	);
	// Computed, not hardcoded: `--out` can put the package anywhere (a satellite
	// checkout, `~/.ryu/plugins/<id>` for a tool an agent made at runtime), and a
	// specifier that only resolves from `plugins-store/<name>/` would make every
	// other location silently SKIP its cases — a green run that tested nothing.
	const harnessSpecifier = relative(outDir, join(HERE, "harness.mjs"))
		.split(sep)
		.join("/");
	writeFileSync(
		join(outDir, "tool.test.mjs"),
		TEST_TEMPLATE(
			harnessSpecifier.startsWith(".")
				? harnessSpecifier
				: `./${harnessSpecifier}`
		)
	);

	const manifestPath = join(outDir, "manifest.json");
	if (existsSync(manifestPath)) {
		process.stdout.write(
			`toolsmith: ${manifestPath} already exists — left untouched. Add the tool seat yourself:\n${JSON.stringify(toolSeat(slug, kind, codeFile), null, "\t")}\n`
		);
	} else {
		writeJson(manifestPath, baseManifest(id, slug, kind, codeFile));
	}

	process.stdout.write(
		`toolsmith: scaffolded ${slug} (${kind}) in ${outDir}\n` +
			"  1. write the body      " +
			`${codeFile}\n` +
			"  2. write the cases     cases.json\n" +
			`  3. verify              node tools/toolsmith/index.mjs verify ${outDir}\n`
	);
}

/** The manifest fragment that seats a tool body, by kind. */
function toolSeat(slug, kind, codeFile) {
	if (kind === "adapter") {
		return {
			provides: [
				{
					capability: "example.verb",
					version: "1.0.0",
					selectable: true,
					tools: {
						[slug]: {
							tool: "provider__tool",
							adapter: { code_file: codeFile },
						},
					},
				},
			],
		};
	}
	return {
		runnables: [
			{
				id: `tool-${slug}`,
				name: slug,
				kind: "tool",
				config: {
					slug,
					backend: "inline_deno",
					description: `TODO: what ${slug} does, in one line the model can route on.`,
					input_schema: {
						type: "object",
						properties: { text: { type: "string", description: "TODO" } },
						required: ["text"],
					},
					// Sealed from `code_file` by `toolsmith sync`. Never hand-edit.
					code: "",
				},
			},
		],
	};
}

function baseManifest(id, slug, kind, codeFile) {
	return {
		id,
		name: basename(id),
		version: "0.1.0",
		description: `TODO: one line on what ${basename(id)} provides.`,
		category: "Developer Tools",
		// `tool:execute` is the grant Core requires before an inline_deno body may
		// run at all (GRANT_TOOL_EXECUTE); without it the tool registers and then
		// refuses every call.
		permission_grants: kind === "inline_tool" ? ["tool:execute"] : [],
		...toolSeat(slug, kind, codeFile),
	};
}

// ── sync ─────────────────────────────────────────────────────────────────────

/**
 * Seal an `inline_deno` body from its authored file into the manifest, or (with
 * `--check`) assert the two already agree.
 *
 * This exists because `ToolConfig` has no `code_file`: the ONLY form Core can
 * load for an inline tool is a JSON string. Authoring in that string is what
 * AGENTS.md bans for hooks and adapters, and for the same reason — nobody audits
 * a `\\n`-escaped blob. So the file is the source form, the manifest is the wire
 * form, and `--check` is what stops them drifting. An adapter needs no sealing:
 * its `code_file` is hydrated by Core directly, so the check is only that the
 * manifest points at the file the cases test.
 */
function sync(dir, flags) {
	const { spec, kind, codePath, code } = loadToolPackage(dir);
	const { manifest, manifestPath, seat } = seatOrDie(dir, spec, kind);

	if (!seat) {
		die(
			`manifest.json does not declare tool '${spec.tool}' — a body nothing references never runs`
		);
	}

	// A file-backed form (adapter / turn hook) has nothing to seal — Core hydrates
	// its `code_file` — so both `sync` and `sync --check` reduce to the same
	// assertion, and it is the shared one the suite also runs.
	if (seat.type !== "inline_deno" || flags.check) {
		const problems = checkBodyDrift(seat, spec, code);
		if (problems.length > 0) {
			die(problems.join("\n  "));
		}
		process.stdout.write(
			`toolsmith: ${spec.tool} manifest matches ${spec.code_file}\n`
		);
		return;
	}

	seat.config.code = code;
	writeJson(manifestPath, manifest);
	process.stdout.write(
		`toolsmith: sealed ${codePath} into ${manifestPath} (${code.length} bytes)\n`
	);
}

// ── verify ───────────────────────────────────────────────────────────────────

/**
 * The gate. Ordered, and the order is load-bearing:
 *
 *   1. **Purity scan** — static, and FIRST because it is the only step that runs
 *      before the body does. Its denylist covers `import`/`require`/`eval`/
 *      `new Function`/`process`/`fetch`/`Deno`, i.e. every escape from the test
 *      harness, so clearing it is what makes step 3 safe to run at all.
 *   2. **Manifest contract** — the seat exists and is wired so the tool is
 *      actually callable and actually routable.
 *   3. **Drift check** — the manifest must carry the body the cases tested.
 *      Skipping this lets a green suite certify code that is not what ships.
 *   4. **Cases** — `node --test`, every case twice, all ambient nondeterminism
 *      shadowed.
 */
function verify(dir) {
	const { spec, kind, codePath, code } = loadToolPackage(dir);

	const violations = scanPurity(code);
	if (violations.length > 0) {
		process.stderr.write(
			`toolsmith: ${spec.tool} is not deterministic — ${violations.length} violation(s):\n${formatViolations(codePath, violations)}\n`
		);
		process.exit(1);
	}
	process.stdout.write(`toolsmith: purity ok (${spec.tool})\n`);

	const { manifest, seat } = seatOrDie(dir, spec, kind);
	if (!seat) {
		die(
			`manifest.json does not declare tool '${spec.tool}' — a body nothing references never runs`
		);
	}
	const problems = checkManifestContract(manifest, spec, kind, seat);
	if (problems.length > 0) {
		process.stderr.write(
			`toolsmith: ${spec.tool} manifest contract — ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join("\n")}\n`
		);
		process.exit(1);
	}
	process.stdout.write(`toolsmith: manifest contract ok (${spec.tool})\n`);

	sync(dir, { check: true });

	const result = spawnSync(
		process.execPath,
		["--test", join(dir, "tool.test.mjs")],
		{ stdio: "inherit", cwd: REPO_ROOT }
	);
	if (result.status !== 0) {
		process.stderr.write(`toolsmith: cases failed for ${spec.tool}\n`);
		process.exit(result.status ?? 1);
	}
	process.stdout.write(`toolsmith: ${spec.tool} VERIFIED\n`);
}

// ── entry ────────────────────────────────────────────────────────────────────

const { flags, positional } = parseArgs(process.argv.slice(2));
const command = positional[0];

switch (command) {
	case "scaffold":
		scaffold(flags);
		break;
	case "verify":
		if (!positional[1]) {
			die("verify requires a plugin directory");
		}
		verify(resolve(positional[1]));
		break;
	case "sync":
		if (!positional[1]) {
			die("sync requires a plugin directory");
		}
		sync(resolve(positional[1]), flags);
		break;
	default:
		process.stderr.write(
			"toolsmith — scaffold, verify and seal Ryu plugin tools\n\n" +
				"  scaffold --id <@scope/name> --tool <slug> [--kind inline_tool|adapter] [--out DIR]\n" +
				"           (regenerates tool.test.mjs; never overwrites the body or cases.json)\n" +
				"  verify   <plugin dir>\n" +
				"  sync     <plugin dir> [--check]\n"
		);
		process.exit(command ? 1 : 0);
}
