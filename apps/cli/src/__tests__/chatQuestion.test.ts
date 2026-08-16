import { afterEach, expect, test } from "bun:test";
import type { ApiTarget } from "@ryuhq/core-client/client";
import {
	parseChatQuestion,
	respondToChatQuestion,
} from "../core/chatQuestion.ts";

const target: ApiTarget = { token: "secret", url: "http://node:7980" };
const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

test("parses normalized Question input and rejects malformed options", () => {
	const question = parseChatQuestion({
		toolCallId: "call-1",
		questions: [
			{
				id: "q-1",
				title: "Pick",
				kind: "single",
				options: [
					{ id: "a", label: "A" },
					{ id: "b", label: "B" },
				],
			},
		],
	});
	expect(question?.toolCallId).toBe("call-1");
	expect(question?.questions[0]?.options).toHaveLength(2);
	expect(
		parseChatQuestion({ toolCallId: "call-1", questions: [{}] })
	).toBeNull();
});

test("posts typed answers to the Core question contract", async () => {
	let body: unknown;
	globalThis.fetch = (async (_input, init) => {
		body = JSON.parse(String(init?.body));
		return new Response(JSON.stringify({ resolved: true }), { status: 200 });
	}) as typeof fetch;
	const question = parseChatQuestion({
		toolCallId: "call-2",
		questions: [{ id: "q-1", title: "Name", kind: "text" }],
	});
	expect(question).not.toBeNull();
	await expect(
		respondToChatQuestion(target, "conv-1", question!, [
			{
				kind: "text",
				question_id: "q-1",
				text: "Ryu",
			},
		])
	).resolves.toBe(true);
	expect(body).toEqual({
		answers: [{ kind: "text", question_id: "q-1", text: "Ryu" }],
		conversation_id: "conv-1",
		tool_call_id: "call-2",
	});
});
