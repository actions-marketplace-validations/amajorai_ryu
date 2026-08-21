import { describe, expect, it } from "bun:test";
import {
	isAgentMessageToolPart,
	readAgentMessagePayload,
} from "./agent-message-tool-logic.ts";

describe("agent message transcript tool", () => {
	it("recognizes MCP send/ask parts without catching other tools", () => {
		expect(isAgentMessageToolPart("tool-mcp-agent-comms.agents.send")).toBe(
			true
		);
		expect(isAgentMessageToolPart("dynamic-tool", "agents.send")).toBe(true);
		expect(isAgentMessageToolPart("tool-mcp-agent-comms.agents.ask")).toBe(
			true
		);
		expect(isAgentMessageToolPart("tool-mcp-mail.send")).toBe(false);
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
			kind: "send",
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
			kind: "send",
			text: "Still working",
			to: "reviewer",
		});
	});

	it("reads an ask question and its returned peer reply", () => {
		expect(
			readAgentMessagePayload({
				input: {
					question: "Can you review the migration?",
					to: "reviewer",
				},
				output: {
					from: "builder",
					question: "Can you review the migration?",
					reply: "The migration is safe to ship.",
					to: "reviewer",
				},
				type: "tool-mcp-agent-comms.agents.ask",
			})
		).toEqual({
			from: "builder",
			kind: "ask",
			reply: "The migration is safe to ship.",
			text: "Can you review the migration?",
			to: "reviewer",
		});
	});

	it("waits for both the recipient and message before rendering a bubble", () => {
		expect(readAgentMessagePayload({ input: { to: "reviewer" } })).toBeNull();
		expect(readAgentMessagePayload({ input: { text: "hello" } })).toBeNull();
	});
});
