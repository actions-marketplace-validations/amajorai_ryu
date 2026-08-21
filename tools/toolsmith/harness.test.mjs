// Tests for the execution harness.
//
// Each guard the harness claims to enforce gets a case that proves it FAILS on the
// bad input, not merely that it passes on the good one. A test harness that
// silently passes is worse than no harness: it converts "untested" into
// "certified".
//
// The static scan is tested separately in `purity.test.mjs`, and the manifest-seat
// checks in `manifest.test.mjs` — one test file per module, beside the module.

import assert from "node:assert/strict";
import test from "node:test";

import { ImpureAccessError, runCase, runOnce } from "./harness.mjs";

// ── shadowed globals ─────────────────────────────────────────────────────────

test("Date.now() throws inside the harness even though the scan is separate", async () => {
	await assert.rejects(
		runOnce({
			kind: "inline_tool",
			code: "return Date.now();",
			testCase: { name: "t", input: {} },
		}),
		ImpureAccessError
	);
});

test("pure members of Math and Date still work", async () => {
	const { value } = await runOnce({
		kind: "inline_tool",
		code: "return { max: Math.max(1, 9), year: new Date(0).getUTCFullYear() };",
		testCase: { name: "t", input: {} },
	});
	assert.deepEqual(value, { max: 9, year: 1970 });
});

test("Math.random() throws while Math.max does not", async () => {
	await assert.rejects(
		runOnce({
			kind: "inline_tool",
			code: "return Math.random();",
			testCase: { name: "t", input: {} },
		}),
		ImpureAccessError
	);
});

test("new Date(ms) is allowed but new Date() is not", async () => {
	await assert.rejects(
		runOnce({
			kind: "inline_tool",
			code: "return new Date().getTime();",
			testCase: { name: "t", input: {} },
		}),
		ImpureAccessError
	);
});

// ── inline tool bindings ─────────────────────────────────────────────────────

test("an inline tool sees input and host and nothing else", async () => {
	const { value, calls } = await runOnce({
		kind: "inline_tool",
		code: "const prior = await host.storage.get('seen'); await host.storage.set('seen', input.name); return { prior, name: input.name };",
		testCase: { name: "t", input: { name: "ada" }, host: { storage: {} } },
	});
	assert.deepEqual(value, { prior: null, name: "ada" });
	// No `namespace: undefined` keys: a case is written in JSON and cannot express
	// `undefined`, so the recording drops absent optionals rather than making every
	// author spell out an argument they never passed.
	assert.deepEqual(calls, [
		{ path: "host.storage.get", args: { key: "seen" } },
		{ path: "host.storage.set", args: { key: "seen", value: "ada" } },
	]);
});

test("host.sideModel serves queued responses in order and then fails loudly", async () => {
	const testCase = {
		name: "t",
		input: {},
		host: { sideModel: [{ text: "one" }] },
	};
	const { value } = await runOnce({
		kind: "inline_tool",
		code: "return await host.sideModel({ prompt: 'x' });",
		testCase,
	});
	assert.deepEqual(value, { text: "one" });

	await assert.rejects(
		runOnce({
			kind: "inline_tool",
			code: "await host.sideModel({}); return await host.sideModel({});",
			testCase,
		}),
		/no response left/
	);
});

test("host.storage.keys is sorted, so write order cannot leak into output", async () => {
	const { value } = await runOnce({
		kind: "inline_tool",
		code: "await host.storage.set('z', '1'); await host.storage.set('a', '2'); return await host.storage.keys();",
		testCase: { name: "t", input: {}, host: { storage: {} } },
	});
	assert.deepEqual(value, ["a", "z"]);
});

// ── adapter bindings ─────────────────────────────────────────────────────────

test("an adapter sees input, defaults, callTool and callNamed", async () => {
	const { value, calls } = await runOnce({
		kind: "adapter",
		code: "const r = await callTool({ q: input.q, limit: defaults.limit }); return { hits: r.n };",
		testCase: {
			name: "t",
			input: { q: "lisbon" },
			defaults: { limit: 5 },
			provider: { call: [{ n: 3 }] },
		},
	});
	assert.deepEqual(value, { hits: 3 });
	assert.deepEqual(calls, [
		{ path: "callTool", args: { q: "lisbon", limit: 5 } },
	]);
});

test("callNamed refuses an id outside the manifest's adapter.tools allowlist", async () => {
	await assert.rejects(
		runOnce({
			kind: "adapter",
			code: "return await callNamed('other.tool', {});",
			testCase: { name: "t", input: {}, provider: { named: {} } },
			adapterTools: ["allowed.tool"],
		}),
		/not in the manifest's adapter.tools allowlist/
	);
});

test("a stub response mutated by the body does not leak into the next run", async () => {
	// structuredClone on every hand-off. Without it a body that mutates what
	// callTool returned would see its own leftovers on run 2, and the
	// double-execution check would pass on a body that is not replayable.
	// ONE queued response, consumed by both runs. Uncloned, run 2 would shift the
	// object run 1 already pushed into and see three items.
	const testCase = {
		name: "t",
		input: {},
		provider: { call: [{ items: [1] }] },
		expect: { n: 2 },
	};
	await runCase({
		kind: "adapter",
		code: "const r = await callTool({}); r.items.push(2); return { n: r.items.length };",
		testCase,
	});
});

// ── turn hook bindings ───────────────────────────────────────────────────────

test("a turn hook sees ctx and host and returns a directive", async () => {
	// The third fragment form: `plugin_host::build_hook_program` injects `ctx`
	// rather than `input`. Nine plugin tests hand-roll this splice today; covering
	// it here is what makes converging them onto the harness a refactor rather
	// than a rewrite.
	const { value, calls } = await runOnce({
		kind: "turn_hook",
		code: "if (!ctx.tool_input) { return { kind: 'none' }; } host.log('seen'); return { kind: 'deny', reason: ctx.tool_input.command };",
		testCase: { name: "t", ctx: { tool_input: { command: "rm -rf /" } } },
	});
	assert.deepEqual(value, { kind: "deny", reason: "rm -rf /" });
	assert.deepEqual(calls, [{ path: "host.log", args: ["seen"] }]);
});

test("a turn hook with no ctx fixture still gets an object, not undefined", async () => {
	const { value } = await runOnce({
		kind: "turn_hook",
		code: "return { kind: ctx.tool_input ? 'deny' : 'none' };",
		testCase: { name: "t" },
	});
	assert.deepEqual(value, { kind: "none" });
});

// ── the determinism protocol ─────────────────────────────────────────────────

test("runCase fails a body whose two runs disagree", async () => {
	// Every ambient nondeterminism source a body could reach is shadowed, and the
	// stubs are rebuilt per run — so the only way to make a body observably flaky
	// is from OUTSIDE, through the fixture. A getter on `input` is evaluated once
	// per `structuredClone`, i.e. once per run, which is exactly the "same call,
	// different answer" the double-execution check exists to catch.
	const testCase = { name: "flaky", input: {}, expect: { v: 1 } };
	let reads = 0;
	Object.defineProperty(testCase.input, "v", {
		enumerable: true,
		get: () => ++reads,
	});

	await assert.rejects(
		runCase({
			kind: "inline_tool",
			code: "return { v: input.v };",
			testCase,
		}),
		/is NOT deterministic/
	);
});

test("runCase requires exactly one expectation", async () => {
	await assert.rejects(
		runCase({
			kind: "inline_tool",
			code: "return 1;",
			testCase: { name: "t", input: {} },
		}),
		/exactly one of expect/
	);
	await assert.rejects(
		runCase({
			kind: "inline_tool",
			code: "return 1;",
			testCase: { name: "t", input: {}, expect: 1, expectError: "x" },
		}),
		/exactly one of expect/
	);
});

test("runCase checks the effect sequence, not only the return value", async () => {
	await assert.rejects(
		runCase({
			kind: "adapter",
			code: "await callTool({ q: 'WRONG' }); return { ok: true };",
			testCase: {
				name: "t",
				input: { q: "right" },
				provider: { call: [{}] },
				expect: { ok: true },
				expectCalls: [{ path: "callTool", args: { q: "right" } }],
			},
		}),
		assert.AssertionError
	);
});

test("expectImpure documents a body that is deliberately rejected", async () => {
	await runCase({
		kind: "inline_tool",
		code: "return Date.now();",
		testCase: { name: "t", input: {}, expectImpure: "Date.now" },
	});
});

test("an implicit global assignment throws instead of leaking across runs", async () => {
	// The splice prepends "use strict" precisely so this fails. Sloppy mode would
	// create a real global that survives into the second run and quietly defeats
	// the double-execution check.
	await assert.rejects(
		runOnce({
			kind: "inline_tool",
			code: "leaked = 1; return leaked;",
			testCase: { name: "t", input: {} },
		}),
		ReferenceError
	);
});
