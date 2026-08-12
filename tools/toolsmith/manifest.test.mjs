// Tests for the manifest-seat checks.
//
// These are the half of the gate that has no other coverage: a purity violation
// or a broken case fails loudly on its own, but a manifest problem is SILENT at
// test time and only shows up as a tool that registers and then never works. So
// each check gets a case proving it reports the problem, and one proving a
// correct manifest reports nothing.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	checkBodyDrift,
	checkManifestContract,
	findManifestSeat,
} from "./manifest.mjs";

/** Write a throwaway package directory and return its path. */
function pkg(manifest) {
	const dir = mkdtempSync(join(tmpdir(), "toolsmith-manifest-"));
	mkdirSync(join(dir, "tools"), { recursive: true });
	writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
	return dir;
}

const INLINE_MANIFEST = {
	id: "@demo/pkg",
	version: "1.0.0",
	description: "A demo package.",
	permission_grants: ["tool:execute"],
	runnables: [
		{
			id: "tool-probe",
			name: "probe",
			kind: "tool",
			config: {
				slug: "probe",
				backend: "inline_deno",
				description: "Probe a thing and return whether it responded.",
				input_schema: { type: "object", properties: {} },
				code: "return 1;",
			},
		},
	],
};

const ADAPTER_MANIFEST = {
	id: "@demo/pkg",
	version: "1.0.0",
	description: "A demo package.",
	provides: [
		{
			capability: "web.search",
			version: "1.0.0",
			tools: {
				web__search: {
					tool: "provider__tool",
					adapter: { code_file: "adapters/web__search.js" },
				},
			},
		},
	],
};

// ── findManifestSeat ─────────────────────────────────────────────────────────

test("finds an inline_deno seat by slug", () => {
	const { seat } = findManifestSeat(
		pkg(INLINE_MANIFEST),
		{ tool: "probe" },
		"inline_tool"
	);
	assert.equal(seat.type, "inline_deno");
	assert.equal(seat.config.slug, "probe");
});

test("finds an adapter seat by canonical verb", () => {
	const { seat } = findManifestSeat(
		pkg(ADAPTER_MANIFEST),
		{ tool: "web__search" },
		"adapter"
	);
	assert.equal(seat.type, "adapter");
	assert.equal(seat.binding.adapter.code_file, "adapters/web__search.js");
});

test("finds a turn hook seat by hook id", () => {
	const dir = pkg({
		id: "@demo/pkg",
		version: "1.0.0",
		description: "A demo package.",
		contributes: {
			turn_hooks: [
				{ id: "guard", on: "pre_tool_use", code_file: "hooks/guard.js" },
			],
		},
	});
	const { seat } = findManifestSeat(dir, { tool: "guard" }, "turn_hook");
	assert.equal(seat.type, "turn_hook");
	assert.equal(seat.hook.code_file, "hooks/guard.js");
});

test("a tool the manifest does not declare yields a null seat, not a throw", () => {
	// Null rather than an exception because the CALLER decides what it means: for
	// `verify` it is a hard failure ("a body nothing references never runs"), and
	// the distinction from "no manifest at all" has to survive to that point.
	const { seat } = findManifestSeat(
		pkg(INLINE_MANIFEST),
		{ tool: "absent" },
		"inline_tool"
	);
	assert.equal(seat, null);
});

test("a package with no manifest throws", () => {
	const dir = mkdtempSync(join(tmpdir(), "toolsmith-empty-"));
	assert.throws(
		() => findManifestSeat(dir, { tool: "probe" }, "inline_tool"),
		/has no manifest\.json/
	);
});

// ── checkBodyDrift ───────────────────────────────────────────────────────────

test("an inline body matching the manifest reports no drift", () => {
	const { seat } = findManifestSeat(
		pkg(INLINE_MANIFEST),
		{ tool: "probe" },
		"inline_tool"
	);
	assert.deepEqual(
		checkBodyDrift(
			seat,
			{ tool: "probe", code_file: "tools/probe.js" },
			"return 1;"
		),
		[]
	);
});

test("an edited-but-unsealed body is reported as drift", () => {
	// The whole reason `sync --check` exists: the manifest string is what Core
	// loads, the file is what gets reviewed and tested.
	const { seat } = findManifestSeat(
		pkg(INLINE_MANIFEST),
		{ tool: "probe" },
		"inline_tool"
	);
	const problems = checkBodyDrift(
		seat,
		{ tool: "probe", code_file: "tools/probe.js" },
		"return 2;"
	);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /has drifted from tools\/probe\.js/);
});

test("an adapter pointing at a different file than the cases test is reported", () => {
	const { seat } = findManifestSeat(
		pkg(ADAPTER_MANIFEST),
		{ tool: "web__search" },
		"adapter"
	);
	const problems = checkBodyDrift(
		seat,
		{ tool: "web__search", code_file: "adapters/other.js" },
		"return 1;"
	);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /points at adapters\/web__search\.js/);
});

test("an adapter that inlines `code` is rejected even when the file matches", () => {
	const manifest = structuredClone(ADAPTER_MANIFEST);
	manifest.provides[0].tools.web__search.adapter.code = "return 1;";
	const { seat } = findManifestSeat(
		pkg(manifest),
		{ tool: "web__search" },
		"adapter"
	);
	const problems = checkBodyDrift(
		seat,
		{ tool: "web__search", code_file: "adapters/web__search.js" },
		"return 1;"
	);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /inlines `code`/);
});

// ── checkManifestContract ────────────────────────────────────────────────────

const inlineSpec = { tool: "probe", code_file: "tools/probe.js" };

function contractFor(manifest, spec = inlineSpec, kind = "inline_tool") {
	const found = findManifestSeat(pkg(manifest), spec, kind);
	return checkManifestContract(found.manifest, spec, kind, found.seat);
}

test("a well-formed inline tool reports no contract problems", () => {
	assert.deepEqual(contractFor(INLINE_MANIFEST), []);
});

test("a missing tool:execute grant is reported", () => {
	// The silent one. Without the grant Core registers the tool, serves it in
	// discovery, and refuses every call — nothing else in the pipeline notices.
	const manifest = structuredClone(INLINE_MANIFEST);
	manifest.permission_grants = [];
	const problems = contractFor(manifest);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /tool:execute/);
});

test("a TODO description is reported for both the package and the tool", () => {
	const manifest = structuredClone(INLINE_MANIFEST);
	manifest.description = "TODO: one line.";
	manifest.runnables[0].config.description = "TODO: what probe does.";
	const problems = contractFor(manifest);
	assert.equal(problems.length, 2);
	assert.ok(problems.every((p) => /description/.test(p)));
});

test("an unscoped plugin id is reported", () => {
	const manifest = structuredClone(INLINE_MANIFEST);
	manifest.id = "pkg";
	const problems = contractFor(manifest);
	assert.match(problems[0], /scoped plugin id/);
});

test("a non-semver version is reported", () => {
	const manifest = structuredClone(INLINE_MANIFEST);
	manifest.version = "1.0";
	const problems = contractFor(manifest);
	assert.match(problems[0], /not semver/);
});

test("a missing input_schema is reported", () => {
	const manifest = structuredClone(INLINE_MANIFEST);
	manifest.runnables[0].config.input_schema = undefined;
	const problems = contractFor(manifest);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /input_schema/);
});

test("an adapter code_file outside hooks|adapters is reported", () => {
	// Mirrors Core's `validate_code_file_path`: exactly `<dir>/<name>.js`, flat,
	// and only those two dirs. A nested or otherwise-rooted path fails at load.
	const problems = contractFor(
		ADAPTER_MANIFEST,
		{ tool: "web__search", code_file: "tools/web__search.js" },
		"adapter"
	);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /must be|is not '<hooks\|adapters>/);
});

test("a nested adapter code_file is reported (the flat-layout rule)", () => {
	const problems = contractFor(
		ADAPTER_MANIFEST,
		{ tool: "web__search", code_file: "adapters/nested/web__search.js" },
		"adapter"
	);
	assert.equal(problems.length, 1);
});
