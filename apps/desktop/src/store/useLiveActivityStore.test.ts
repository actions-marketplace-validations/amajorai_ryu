import { describe, expect, it } from "bun:test";
import type { LiveActivity } from "@ryu/app-host/live-activity";
import { hasWorkingAgent } from "./useLiveActivityStore.ts";

const activity = (
	id: string,
	status: LiveActivity["status"]
): LiveActivity => ({
	appId: "shell",
	detail: "working",
	id,
	kind: "agent-run",
	startedAt: 1,
	status,
	title: id,
	updatedAt: 1,
});

describe("hasWorkingAgent", () => {
	it("treats many working runs as one aggregate playback demand", () => {
		expect(
			hasWorkingAgent([
				activity("run-1", "running"),
				activity("run-2", "running"),
			])
		).toBe(true);
	});

	it("stops demanding playback when no run is actively working", () => {
		expect(hasWorkingAgent([activity("run-1", "waiting")])).toBe(false);
		expect(hasWorkingAgent([activity("run-1", "done")])).toBe(false);
		expect(hasWorkingAgent([])).toBe(false);
	});
});
