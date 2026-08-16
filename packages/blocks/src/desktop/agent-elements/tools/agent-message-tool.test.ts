import { describe, expect, it } from "bun:test";
import {
	isAgentMessageToolPart,
	readAgentMessagePayload,
} from "./agent-message-tool-logic.ts";

describe("agent message transcript tool", () => {
	it("recognizes MCP and dynamic send parts without catching other tools", () => {
		expect(
			isAgentMessageToolPart("tool-mcp__agent-comms__agents__send")
		).toBe(true);
		expect(isAgentMessageToolPart("dynamic-tool", "agents__send")).toBe(true);
		expect(isAgentMessageToolPart("tool-mcp__agent-comms__agents__ask")).toBe(
			false
		);
		expect(isAgentMessageToolPart("tool-mcp__mail__send")).toBe(false);
	});

	it("reads the message from input and the host-derived sender from output", () => {
		expect(
			readAgentMessagePayload({
				input: { text: "The deploy is ready.", to: "research" },
				output: [
					{
						text: JSON.stringify({ from: "builder", ok: true, to: "research" }),
						type: "text",
					},
				],
			})
		).toEqual({
			from: "builder",
			text: "The deploy is ready.",
			to: "research",
		});
	});

	it("supports streamed JSON inputs before a result is available", () => {
		expect(
			readAgentMessagePayload({
				input: '{"text":"Still working","to":"reviewer"}',
				state: "input-available",
			})
		).toEqual({
			text: "Still working",
			to: "reviewer",
		});
	});

	it("waits for both the recipient and message before rendering a bubble", () => {
		expect(readAgentMessagePayload({ input: { to: "reviewer" } })).toBeNull();
		expect(readAgentMessagePayload({ input: { text: "hello" } })).toBeNull();
	});
});
