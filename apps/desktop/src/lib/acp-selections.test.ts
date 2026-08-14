// apps/desktop/src/lib/acp-selections.test.ts
//
// Tests for the per-agent ACP selection persistence (permission mode, model,
// and nested config-option values). These are localStorage-backed "last used"
// hints keyed by agent id; the load-bearing behaviour is per-agent isolation
// (writing agent A never leaks into agent B), null-agent guards, and graceful
// fallback to empty/null on corrupt or missing storage.
//
// A real DOM (localStorage) is required; register happy-dom before importing.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// happy-dom registers one global DOM per process; several files register it in
// a single `bun test` run, so guard against the "already registered" throw.
// `isRegistered` is the registrator's OWN state, and it is the only thing
// `register()` actually checks before throwing. The previous guard tested
// `globalThis.window`, which is a different question: bun runs every file in this
// package in ONE process, so the registrator module — and its private
// `#registered` flag — is shared across files while `globalThis.window` is not a
// reliable proxy for it. The result was "Happy DOM has already been globally
// registered" thrown from whichever file happened to be evaluated second,
// failing 25 tests across 9 files that all pass individually.
if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}

import { beforeEach, describe, expect, test } from "bun:test";
import {
	getAcpConfig,
	getAcpMode,
	getAcpModel,
	setAcpConfigValue,
	setAcpMode,
	setAcpModel,
} from "./acp-selections.ts";

beforeEach(() => {
	localStorage.clear();
});

describe("acp mode + model persistence", () => {
	test("round-trips a mode per agent", () => {
		setAcpMode("agent-a", "plan");
		expect(getAcpMode("agent-a")).toBe("plan");
	});

	test("round-trips a model per agent", () => {
		setAcpModel("agent-a", "opus");
		expect(getAcpModel("agent-a")).toBe("opus");
	});

	test("keeps agents isolated from one another", () => {
		setAcpMode("agent-a", "plan");
		setAcpMode("agent-b", "auto");
		expect(getAcpMode("agent-a")).toBe("plan");
		expect(getAcpMode("agent-b")).toBe("auto");
	});

	test("returns null for an unknown agent and for a null agent id", () => {
		expect(getAcpMode("never-set")).toBeNull();
		expect(getAcpMode(null)).toBeNull();
		expect(getAcpModel(null)).toBeNull();
	});

	test("overwrites an existing selection in place", () => {
		setAcpModel("agent-a", "sonnet");
		setAcpModel("agent-a", "opus");
		expect(getAcpModel("agent-a")).toBe("opus");
	});

	test("recovers null from a corrupt stored blob", () => {
		localStorage.setItem("ryu_acp_mode", "{not json");
		expect(getAcpMode("agent-a")).toBeNull();
	});
});

describe("acp nested config values", () => {
	test("stores config values as a nested per-agent map", () => {
		setAcpConfigValue("agent-a", "reasoning", "high");
		expect(getAcpConfig("agent-a")).toEqual({ reasoning: "high" });
	});

	test("merges a second config key without clobbering the first", () => {
		setAcpConfigValue("agent-a", "reasoning", "high");
		setAcpConfigValue("agent-a", "verbosity", "low");
		expect(getAcpConfig("agent-a")).toEqual({
			reasoning: "high",
			verbosity: "low",
		});
	});

	test("keeps config maps isolated across agents", () => {
		setAcpConfigValue("agent-a", "reasoning", "high");
		setAcpConfigValue("agent-b", "reasoning", "low");
		expect(getAcpConfig("agent-a")).toEqual({ reasoning: "high" });
		expect(getAcpConfig("agent-b")).toEqual({ reasoning: "low" });
	});

	test("returns {} for an unset agent, a null id, and corrupt storage", () => {
		expect(getAcpConfig("never-set")).toEqual({});
		expect(getAcpConfig(null)).toEqual({});
		localStorage.setItem("ryu_acp_config", "{bad");
		expect(getAcpConfig("agent-a")).toEqual({});
	});
});
