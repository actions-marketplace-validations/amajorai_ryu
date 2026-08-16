import { describe, expect, test } from "bun:test";
import {
	extractWorkflowRun,
	isWorkflowRunProgress,
} from "./workflow-run-data.ts";

const run = {
	id: "workflow-run",
	nodes: [{ id: "ask", kind: "approval", status: "completed" as const }],
	runId: "run-1",
	status: "awaiting_input" as const,
	workflowId: "workflow-1",
	workflowName: "Review",
};

describe("workflow run stream data", () => {
	test("extracts the newest frame when the SDK gives an array", () => {
		const message = {
			parts: [
				{
					data: [{ ...run, status: "running" as const }, run],
					type: "data-ryu-workflow",
				},
			],
		};

		expect(extractWorkflowRun(message)).toEqual(run);
	});

	test("rejects malformed stream data instead of rendering a partial card", () => {
		const malformed = { ...run, nodes: [{ id: "ask", status: "unknown" }] };

		expect(isWorkflowRunProgress(malformed)).toBe(false);
		expect(
			extractWorkflowRun({
				parts: [{ data: malformed, type: "data-ryu-workflow" }],
			})
		).toBeNull();
	});
});
