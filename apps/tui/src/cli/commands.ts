// The `ryu` subcommand registry: a flat list of {@link Command}s, each mapping to
// an existing Core endpoint via the injected {@link CoreApi}. A registry (name →
// handler) is deliberately used over a big switch so app-contributed subcommands
// can later extend it (see the extension seam in dispatch.ts).
//
// Endpoint map (all pre-existing Core lifecycle routes, wrapped by core-client):
//   list/ls           GET  /api/plugins                (fetchApps)
//   catalog/search    GET  /api/plugins/catalog        (fetchAppsCatalog)
//   add/install       POST /api/plugins/:id/install    (installApp)
//   enable            POST /api/plugins/:id/enable      (enableApp)
//   disable           POST /api/plugins/:id/disable     (disableApp)
//   uninstall/rm      POST /api/plugins/:id/uninstall   (uninstallApp)
//   init              local  → bunx create-ryu-app      (ctx.scaffold)
//   chat              POST /api/chat/stream             (streamChat, SSE)
//   node ls/use       local ~/.ryu/nodes.json store     (loadNodes/setActive)
//   help / version    local
//
// Apps AND plugins: every lifecycle command above takes a plain id and works for
// both, because Core has ONE lifecycle API — `/api/plugins/:id/*` does not care
// whether the manifest ships a Companion UI. "app" vs "plugin" is a catalog
// classification (see kind.ts), so it shows up here only as the `--kind` filter
// and the KIND column, never as a second install path.

import { loadNodes, resolveActive, setActive } from "../core/nodes.ts";
import {
	catalogEntryKind,
	installedAppKind,
	kindFilterPlural,
	matchesKind,
	parseKindFilter,
} from "./kind.ts";
import { formatTable, truncate } from "./output.ts";
import { type CliContext, type Command, UsageError } from "./types.ts";
import { VERSION } from "./version.ts";

const DESCRIPTION_WIDTH = 50;

/** Read the first positional arg or throw a usage error naming the correct form. */
function requireArg(ctx: CliContext, name: string, usage: string): string {
	const value = ctx.args[0];
	if (!value) {
		throw new UsageError(`Missing ${name}. Usage: ${usage}`);
	}
	return value;
}

/** `ryu list` / `ryu ls` — installed apps and plugins (id, name, kind, enabled).
 *  `--kind` narrows to one classification; unset = both, which is the pre-flag
 *  behavior and so cannot break a script that predates it. `--json` keeps emitting
 *  the raw AppInfo records (filtered, never reshaped) — a consumer that wants the
 *  classification derives it from `runnables` exactly as the KIND column does. */
const listCommand: Command = {
	name: "list",
	aliases: ["ls"],
	summary: "List installed apps and plugins",
	usage: "ryu list [--kind app|plugin|all] [--json]",
	run: async (ctx) => {
		const filter = parseKindFilter(ctx.flags.kind);
		const apps = await ctx.api.fetchApps(ctx.target);
		const installed = apps.filter(
			(a) =>
				(a.installed || a.builtIn) && matchesKind(filter, installedAppKind(a))
		);
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify(installed, null, 2)}\n`);
			return 0;
		}
		if (installed.length === 0) {
			ctx.io.out(`No ${kindFilterPlural(filter)} installed.\n`);
			return 0;
		}
		const rows = installed.map((a) => [
			a.id,
			a.name,
			installedAppKind(a),
			a.enabled ? "yes" : "no",
		]);
		ctx.io.out(`${formatTable(["ID", "NAME", "KIND", "ENABLED"], rows)}\n`);
		return 0;
	},
};

/** `ryu catalog` / `ryu search [q]` — installable apps AND plugins from the remote
 *  registry. One Core endpoint returns both, so both have always been listed here;
 *  the KIND column is what finally makes them distinguishable, and `--kind` is the
 *  narrowing a scripted caller needs. */
const catalogCommand: Command = {
	name: "catalog",
	aliases: ["search"],
	summary: "Browse/search installable apps and plugins",
	usage: "ryu catalog [query] [--kind app|plugin|all] [--json]",
	run: async (ctx) => {
		const filter = parseKindFilter(ctx.flags.kind);
		const entries = await ctx.api.fetchAppsCatalog(ctx.target);
		const query = ctx.args[0]?.toLowerCase();
		const matches = entries
			.filter((e) => matchesKind(filter, catalogEntryKind(e)))
			.filter(
				(e) =>
					!query ||
					e.id.toLowerCase().includes(query) ||
					e.name.toLowerCase().includes(query) ||
					e.tags.some((t) => t.toLowerCase().includes(query))
			);
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify(matches, null, 2)}\n`);
			return 0;
		}
		if (matches.length === 0) {
			ctx.io.out(`No matching ${kindFilterPlural(filter)}.\n`);
			return 0;
		}
		const rows = matches.map((e) => [
			e.id,
			e.name,
			catalogEntryKind(e),
			e.version,
			truncate(e.description, DESCRIPTION_WIDTH),
		]);
		ctx.io.out(
			`${formatTable(["ID", "NAME", "KIND", "VERSION", "DESCRIPTION"], rows)}\n`
		);
		return 0;
	},
};

/** `ryu add <id>` / `ryu install <id>` — the shadcn-style install command. Takes
 *  the id of an app OR a plugin: `POST /api/plugins/:id/install` is the single
 *  lifecycle route for both, so there is nothing to branch on here. */
const addCommand: Command = {
	name: "add",
	aliases: ["install"],
	summary: "Install an app or plugin from the catalog",
	usage: "ryu add <id> [--json]",
	run: async (ctx) => {
		const id = requireArg(ctx, "app or plugin id", "ryu add <id>");
		const record = await ctx.api.installApp(ctx.target, id);
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify(record, null, 2)}\n`);
			return 0;
		}
		ctx.io.out(
			`Installed ${record.id}@${record.version} (disabled). Run 'ryu enable ${record.id}' to turn it on.\n`
		);
		return 0;
	},
};

/** `ryu enable <id>` — apps and plugins alike (one Core route for both). */
const enableCommand: Command = {
	name: "enable",
	summary: "Enable an installed app or plugin",
	usage: "ryu enable <id> [--json]",
	run: async (ctx) => {
		const id = requireArg(ctx, "app or plugin id", "ryu enable <id>");
		const record = await ctx.api.enableApp(ctx.target, id);
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify(record, null, 2)}\n`);
			return 0;
		}
		ctx.io.out(`Enabled ${record.id}.\n`);
		return 0;
	},
};

/** `ryu disable <id>` (`--cascade` to disable dependents too). */
const disableCommand: Command = {
	name: "disable",
	summary: "Disable an app or plugin",
	usage: "ryu disable <id> [--cascade] [--json]",
	run: async (ctx) => {
		const id = requireArg(ctx, "app or plugin id", "ryu disable <id>");
		const record = await ctx.api.disableApp(ctx.target, id, {
			cascade: ctx.flags.cascade,
		});
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify(record, null, 2)}\n`);
			return 0;
		}
		ctx.io.out(`Disabled ${record.id}.\n`);
		return 0;
	},
};

/** `ryu uninstall <id>` / `ryu rm <id>` (`--cascade` for dependents). */
const uninstallCommand: Command = {
	name: "uninstall",
	aliases: ["rm"],
	summary: "Uninstall an app or plugin",
	usage: "ryu uninstall <id> [--cascade] [--json]",
	run: async (ctx) => {
		const id = requireArg(ctx, "app or plugin id", "ryu uninstall <id>");
		const result = await ctx.api.uninstallApp(ctx.target, id, {
			cascade: ctx.flags.cascade,
		});
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify(result, null, 2)}\n`);
			return 0;
		}
		ctx.io.out(`Uninstalled ${result.removed}.\n`);
		if (result.notice) {
			ctx.io.out(`${result.notice}\n`);
		}
		return 0;
	},
};

/** `ryu init <name> [--template <t>]` — scaffold a new app or plugin project.
 *
 *  Templates are NOT reimplemented here. `create-ryu-app` is the source of truth
 *  for what an app/plugin skeleton looks like, and `ctx.scaffold` shells out to it
 *  exactly as a user would (`bunx create-ryu-app <name> [--template <t>]`). Two
 *  things that would look tempting are wrong: importing the package would give the
 *  tui a build-time dependency on a package it does not own AND freeze its template
 *  list into this binary; and validating `<name>`/`--template` here would duplicate
 *  the scaffolder's own gates, so a template added upstream would be rejected by a
 *  stale copy of the list. Both are deliberately left to the child, whose usage
 *  text is forwarded verbatim on failure. */
const initCommand: Command = {
	name: "init",
	summary: "Scaffold a new app or plugin project",
	usage: "ryu init <name> [--template <t>]",
	run: async (ctx) => {
		const name = requireArg(ctx, "project name", "ryu init <name>");
		const template = ctx.flags.template;
		const argv = template ? [name, "--template", template] : [name];
		const result = await ctx.scaffold(argv);
		const ok = result.exitCode === 0;
		if (ctx.flags.json) {
			ctx.io.out(
				`${JSON.stringify({
					name,
					template: template ?? null,
					exitCode: result.exitCode,
					stdout: result.stdout,
					stderr: result.stderr,
				})}\n`
			);
			return ok ? 0 : 1;
		}
		// The scaffolder prints its own "created …/ next steps:" block — forward it
		// rather than paraphrasing, so `ryu init` and `bunx create-ryu-app` never
		// tell a user two different things about the project they just made.
		if (result.stdout) {
			ctx.io.out(result.stdout);
		}
		if (result.stderr) {
			ctx.io.err(result.stderr);
		}
		return ok ? 0 : 1;
	},
};

/** `ryu chat "<msg>"` — one-shot chat: stream the assistant reply, then exit. */
const chatCommand: Command = {
	name: "chat",
	summary: "Send one message and print the reply",
	usage: 'ryu chat "<message>" [--json]',
	run: async (ctx) => {
		const message = ctx.args.join(" ").trim();
		if (!message) {
			throw new UsageError('Missing message. Usage: ryu chat "<message>"');
		}
		let collected = "";
		let streamError: string | null = null;
		await ctx.api.streamChat(
			ctx.target,
			[{ role: "user", content: message }],
			{},
			{
				onTextDelta: (delta) => {
					if (ctx.flags.json) {
						collected += delta;
					} else {
						ctx.io.out(delta);
					}
				},
				onError: (m) => {
					streamError = m;
				},
				onDone: () => {
					/* resolved by streamChat returning */
				},
			}
		);
		if (streamError) {
			throw new Error(streamError);
		}
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify({ text: collected })}\n`);
		} else {
			ctx.io.out("\n");
		}
		return 0;
	},
};

/** `ryu node ls` / `ryu node use <name|url>` — the local multi-node store. */
const nodeCommand: Command = {
	name: "node",
	summary: "List or switch the active Core node",
	usage: "ryu node <ls | use <name|url>> [--json]",
	run: async (ctx) => {
		const sub = ctx.args[0] ?? "ls";
		if (sub === "ls" || sub === "list") {
			const config = loadNodes();
			const active = resolveActive(config).name;
			if (ctx.flags.json) {
				ctx.io.out(
					`${JSON.stringify({ active, nodes: config.nodes }, null, 2)}\n`
				);
				return 0;
			}
			const rows = config.nodes.map((n) => [
				n.name === active ? "*" : "",
				n.name,
				n.url,
			]);
			ctx.io.out(`${formatTable(["", "NAME", "URL"], rows)}\n`);
			return 0;
		}
		if (sub === "use") {
			const ref = ctx.args[1];
			if (!ref) {
				throw new UsageError("Usage: ryu node use <name|url>");
			}
			const config = loadNodes();
			const match = config.nodes.find((n) => n.name === ref || n.url === ref);
			if (match) {
				setActive(match.name);
				ctx.io.out(`Active node set to ${match.name} (${match.url}).\n`);
				return 0;
			}
			// The node store keys on NAME, not arbitrary URLs — be honest about the
			// per-invocation escape hatch rather than silently inventing a node.
			const names = config.nodes.map((n) => n.name).join(", ");
			ctx.io.err(
				`No configured node named or matching '${ref}'. Configured: ${names}.\nTo target an arbitrary node for one command, use --node <url> or set RYU_CORE_URL.\n`
			);
			return 1;
		}
		throw new UsageError("Usage: ryu node <ls | use <name|url>>");
	},
};

/** `ryu version` / `ryu --version`. */
const versionCommand: Command = {
	name: "version",
	summary: "Print the ryu version",
	usage: "ryu version",
	run: async (ctx) => {
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify({ version: VERSION })}\n`);
		} else {
			ctx.io.out(`ryu ${VERSION}\n`);
		}
		return 0;
	},
};

/** All built-in commands, in help-display order. `help` is appended below so its
 *  handler can close over this same list. */
const BASE_COMMANDS: Command[] = [
	listCommand,
	catalogCommand,
	addCommand,
	enableCommand,
	disableCommand,
	uninstallCommand,
	initCommand,
	chatCommand,
	nodeCommand,
	versionCommand,
];

/** Build the `ryu help` text from the registry so it never drifts from reality. */
export function renderHelp(): string {
	const lines: string[] = [
		"ryu — interactive TUI + scriptable CLI for a Ryu Core node.",
		"",
		"Usage:",
		"  ryu               Open the interactive TUI (same as 'ryu tui')",
		"  ryu <command> …   Run a one-shot command",
		"",
		"Commands:",
	];
	const all = [...BASE_COMMANDS, helpCommand];
	const appLine = "ryu <app> <cmd>";
	const width = Math.max(...all.map((c) => c.usage.length), appLine.length);
	for (const cmd of all) {
		lines.push(`  ${cmd.usage.padEnd(width)}  ${cmd.summary}`);
	}
	// App-contributed subcommands (surfaces.cli.commands) — resolved at runtime
	// against the active node; run `ryu <app>` to list what an app contributes.
	lines.push(
		`  ${appLine.padEnd(width)}  Run a command an installed app/plugin contributes`
	);
	lines.push(
		"",
		"Global flags:",
		"  --json          Machine-readable output (for agents/CI)",
		"  --node <url>    Target a specific Core node for this invocation",
		"  --kind <k>      Filter list/catalog: app | plugin | all (default: all)",
		"  --template <t>  Template for 'ryu init' (passed to create-ryu-app)",
		"  --force         Override a refused operation where supported",
		"  --cascade       Include dependents on disable/uninstall",
		"  -h, --help      Show this help",
		"  --version       Print the version",
		"",
		"Apps vs plugins: both install, enable, disable and uninstall by id through the",
		"same commands — an app is a plugin that also ships a full-page UI. Use --kind",
		"to browse one at a time.",
		"",
		"Node targeting: RYU_CORE_URL / RYU_CORE_TOKEN (env) or --node <url>."
	);
	return lines.join("\n");
}

/** `ryu help` / `ryu -h` / `ryu --help`. */
const helpCommand: Command = {
	name: "help",
	summary: "Show this help",
	usage: "ryu help",
	run: async (ctx) => {
		ctx.io.out(`${renderHelp()}\n`);
		return 0;
	},
};

/** The complete registry, including `help`. */
export const COMMANDS: Command[] = [...BASE_COMMANDS, helpCommand];

/** Resolve a subcommand token to its {@link Command}, honoring aliases. */
export function findCommand(name: string): Command | undefined {
	return COMMANDS.find(
		(c) => c.name === name || (c.aliases?.includes(name) ?? false)
	);
}
