import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { AgentSummary } from "@/src/lib/api/agents.ts";

if (typeof document === "undefined") {
	GlobalRegistrator.register();
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const profiles: Array<{
	resolve: (value: {
		profiles: Array<{ provider: string; importEnabled: boolean }>;
	}) => void;
	reject: (error: Error) => void;
}> = [];
const listThreads = mock(async () => ({
	supported: true,
	engine: "codex",
	threads: [{ id: "thread-1" }],
}));
const importThread = mock(async () => ({ alreadyImported: false }));
const onImported = mock(() => undefined);
mock.module("@/src/lib/api/agent-sync.ts", () => ({
	listAgentSyncProfiles: () =>
		new Promise((resolve, reject) => profiles.push({ resolve, reject })),
}));
mock.module("@/src/lib/api/agent-threads.ts", () => ({
	listAgentThreads: listThreads,
	importAgentThread: importThread,
}));
mock.module("@/src/lib/agent-logos.tsx", () => ({
	engineForAgent: (agent: AgentSummary) => agent.engine,
}));
mock.module("@/src/store/useWorkspaceStore.ts", () => ({
	useWorkspaceStore: () => () => undefined,
}));
const { useAutoThreadImport } = await import("./useAutoThreadImport.ts");
const target = { url: "https://fixture.example", token: null };
function Harness({
	agents = [{ id: "codex", engine: "codex" } as AgentSummary],
}: {
	agents?: AgentSummary[];
}) {
	useAutoThreadImport({ agents, target, onImported });
	return null;
}
let root = createRoot(document.createElement("div"));
let now = 100_000;
const date = spyOn(Date, "now").mockImplementation(() => now);
afterAll(() => date.mockRestore());
async function focus() {
	now += 31_000;
	await act(async () => {
		window.dispatchEvent(new Event("focus"));
	});
}
afterEach(async () => {
	await act(async () => root.unmount());
	root = createRoot(document.createElement("div"));
	profiles.length = 0;
	listThreads.mockClear();
	importThread.mockClear();
	onImported.mockClear();
	localStorage.clear();
});

test("focus events cannot overlap a slow sync-profile read or duplicate imports", async () => {
	await act(async () => root.render(<Harness />));
	await focus();
	await focus();
	expect(profiles).toHaveLength(1);
	await act(async () => profiles[0].resolve({ profiles: [] }));
	expect(listThreads).toHaveBeenCalledTimes(1);
	expect(importThread).toHaveBeenCalledTimes(1);
	expect(onImported).toHaveBeenCalledTimes(1);
	await focus();
	expect(profiles).toHaveLength(2);
	await act(async () => profiles[1].resolve({ profiles: [] }));
	expect(importThread).toHaveBeenCalledTimes(1);
});

test("an empty roster does not request sync profiles", async () => {
	await act(async () => root.render(<Harness agents={[]} />));
	await focus();
	expect(profiles).toHaveLength(0);
	expect(listThreads).not.toHaveBeenCalled();
});

test("a failed profile read releases the scan gate and retains legacy import", async () => {
	await act(async () => root.render(<Harness />));
	await focus();
	await act(async () => profiles[0].reject(new Error("offline")));
	expect(importThread).toHaveBeenCalledTimes(1);
	await focus();
	expect(profiles).toHaveLength(2);
});

test("unmount during the profile read prevents follow-up work", async () => {
	await act(async () => root.render(<Harness />));
	await focus();
	await act(async () => root.render(null));
	await act(async () => profiles[0].resolve({ profiles: [] }));
	expect(listThreads).not.toHaveBeenCalled();
	expect(importThread).not.toHaveBeenCalled();
	expect(onImported).not.toHaveBeenCalled();
});

test("Core-managed engines skip native history without persisting a redundant seen set", async () => {
	await act(async () => root.render(<Harness />));
	await focus();
	await act(async () =>
		profiles[0].resolve({
			profiles: [{ provider: "codex", importEnabled: true }],
		})
	);
	expect(listThreads).not.toHaveBeenCalled();
	expect(localStorage.getItem("ryu:auto-imported-thread-ids")).toBeNull();
	await focus();
	expect(profiles).toHaveLength(2);
});

test("disabled import and unsupported engines perform no reads", async () => {
	localStorage.setItem("ryu:auto-import-agent-threads", "false");
	await act(async () => root.render(<Harness />));
	await focus();
	expect(profiles).toHaveLength(0);
	localStorage.removeItem("ryu:auto-import-agent-threads");
	await act(async () =>
		root.render(
			<Harness agents={[{ id: "local", engine: "local" } as AgentSummary]} />
		)
	);
	await focus();
	expect(profiles).toHaveLength(0);
});
