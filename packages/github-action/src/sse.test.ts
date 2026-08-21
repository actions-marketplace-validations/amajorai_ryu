import { describe, expect, it } from "bun:test";
import { parseCoreChatStream } from "./sse.ts";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
}

describe("Ryu Core chat SSE parser", () => {
	it("handles split JSON, CRLF boundaries, tools, workflows, finish, and unknown frames", async () => {
		const payload = [
			'data: {"type":"start","run_id":"run-42"}\r\n',
			'data: {"type":"text-delta","delta":"Hel',
			'lo "}\r\n',
			'data: {"type":"tool-input-available","toolCallId":"call-1","toolName":"ryu.search","input":{"query":"agents"}}\r\n',
			'data: {"type":"data-ryu-workflow","data":{"step":"review","status":"done"}}\r\n',
			'data: {"type":"unknown-frame","data":{"ignored":true}}\r\n',
			'data: {"type":"tool-output-available","tool_call_id":"call-1","output":{"status":"ok","value":"yes"}}\r\n',
			'data: {"type":"text-delta","delta":"Ryu"}\r\n',
			'data: {"type":"finish"}\r\n',
			"data: [DONE]\r\n",
		].join("");
		const frames: unknown[] = [];

		const result = await parseCoreChatStream(
			streamFromChunks([
				payload.slice(0, 41),
				payload.slice(41, 42),
				payload.slice(42, 107),
				payload.slice(107),
			]),
			"conversation-1",
			{ onFrame: (frame) => frames.push(frame) }
		);

		expect(result).toMatchObject({
			conversationId: "conversation-1",
			finished: true,
			runId: "run-42",
			text: "Hello Ryu",
		});
		expect(result.toolEvents).toEqual([
			{
				type: "input",
				toolCallId: "call-1",
				toolName: "ryu.search",
				input: { query: "agents" },
			},
			{
				type: "output",
				toolCallId: "call-1",
				toolName: null,
				output: { status: "ok", value: "yes" },
				status: "ok",
			},
		]);
		expect(result.workflowEvents).toEqual([{ step: "review", status: "done" }]);
		expect(frames).toHaveLength(8);
	});

	it("ignores malformed data lines but surfaces stream errors", async () => {
		const result = await parseCoreChatStream(
			streamFromChunks([
				"data: {not-json}\n",
				'data: {"type":"text-delta","delta":"safe"}\n',
			]),
			"conversation-2"
		);
		expect(result.text).toBe("safe");

		await expect(
			parseCoreChatStream(
				streamFromChunks(['data: {"type":"error","errorText":"denied"}\n']),
				"conversation-3"
			)
		).rejects.toThrow("denied");
	});
});
