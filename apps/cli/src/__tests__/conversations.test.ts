import { afterEach, expect, test } from "bun:test";
import type { ApiTarget } from "@ryuhq/core-client/client";
import {
	deleteConversation,
	forkConversation,
	renameConversation,
	resumeConversation,
	setConversationPinned,
} from "../core/conversations.ts";

const target: ApiTarget = { url: "http://node:7980", token: "node-secret" };
const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

test("forks a whole conversation without inventing a request body", async () => {
	let url = "";
	let init: RequestInit | undefined;
	globalThis.fetch = ((requestUrl: string | URL, requestInit?: RequestInit) => {
		url = String(requestUrl);
		init = requestInit;
		return Promise.resolve(
			new Response(JSON.stringify({ conversation: { id: "forked-1" } }), {
				status: 201,
				headers: { "Content-Type": "application/json" },
			})
		);
	}) as typeof fetch;

	await expect(forkConversation(target, "conversation/1")).resolves.toBe(
		"forked-1"
	);
	expect(url).toBe("http://node:7980/api/conversations/conversation%2F1/fork");
	expect(init?.method).toBe("POST");
	expect(init?.body).toBeUndefined();
	expect((init?.headers as Record<string, string>).Authorization).toBe(
		"Bearer node-secret"
	);
});

test("sends an optional message id when forking from a branch point", async () => {
	let body = "";
	globalThis.fetch = ((_url: string | URL, init?: RequestInit) => {
		body = String(init?.body);
		return Promise.resolve(
			new Response(JSON.stringify({ conversation: { id: "forked-2" } }), {
				status: 201,
			})
		);
	}) as typeof fetch;

	await expect(
		forkConversation(target, "conversation-1", "message-7")
	).resolves.toBe("forked-2");
	expect(JSON.parse(body)).toEqual({ message_id: "message-7" });
});

test("rejects unsuccessful responses and malformed fork results", async () => {
	globalThis.fetch = (() =>
		Promise.resolve(
			new Response("", { status: 404 })
		)) as unknown as typeof fetch;
	await expect(forkConversation(target, "conversation-1")).rejects.toThrow(
		"Fork conversation failed: 404"
	);

	globalThis.fetch = (() =>
		Promise.resolve(
			new Response(JSON.stringify({ conversation: {} }), { status: 201 })
		)) as unknown as typeof fetch;
	await expect(forkConversation(target, "conversation-1")).rejects.toThrow(
		"Fork conversation returned no conversation id"
	);
});

test("sets the server-backed pinned state", async () => {
	let url = "";
	let init: RequestInit | undefined;
	globalThis.fetch = ((requestUrl: string | URL, requestInit?: RequestInit) => {
		url = String(requestUrl);
		init = requestInit;
		return Promise.resolve(
			new Response(JSON.stringify({ ok: true }), { status: 200 })
		);
	}) as typeof fetch;

	await expect(
		setConversationPinned(target, "conversation/1", true)
	).resolves.toBeUndefined();
	expect(url).toBe(
		"http://node:7980/api/conversations/conversation%2F1/pinned"
	);
	expect(init?.method).toBe("POST");
	expect(JSON.parse(String(init?.body))).toEqual({ value: true });
	expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
		"application/json"
	);
});

test("reports pinning failures", async () => {
	globalThis.fetch = (() =>
		Promise.resolve(
			new Response("", { status: 404 })
		)) as unknown as typeof fetch;
	await expect(
		setConversationPinned(target, "conversation-1", false)
	).rejects.toThrow("Unpin conversation failed: 404");
});

test("resumes a conversation and preserves structured message parts", async () => {
	let url = "";
	globalThis.fetch = ((requestUrl: string | URL) => {
		url = String(requestUrl);
		return Promise.resolve(
			new Response(
				JSON.stringify({
					id: "conversation-1",
					title: "Saved chat",
					messages: [
						{ id: "m1", role: "user", content: "hello" },
						{
							id: "m2",
							role: "assistant",
							content: "hi",
							parts: [{ type: "text", text: "hi" }],
						},
					],
				}),
				{ status: 200 }
			)
		);
	}) as typeof fetch;

	await expect(resumeConversation(target, "conversation/1")).resolves.toEqual({
		id: "conversation-1",
		title: "Saved chat",
		messages: [
			{ id: "m1", role: "user", content: "hello", parts: undefined },
			{
				id: "m2",
				role: "assistant",
				content: "hi",
				parts: [{ type: "text", text: "hi" }],
			},
		],
	});
	expect(url).toBe("http://node:7980/api/conversations/conversation%2F1");
});

test("renames with a trimmed title and rejects blank titles", async () => {
	let body = "";
	globalThis.fetch = ((_url: string | URL, init?: RequestInit) => {
		body = String(init?.body);
		return Promise.resolve(
			new Response(JSON.stringify({ ok: true, title: "New title" }), {
				status: 200,
			})
		);
	}) as typeof fetch;

	await expect(
		renameConversation(target, "conversation-1", "  New title ")
	).resolves.toBe("New title");
	expect(JSON.parse(body)).toEqual({ title: "New title" });
	await expect(
		renameConversation(target, "conversation-1", "   ")
	).rejects.toThrow("Conversation title must not be empty");
});

test("deletes a conversation and reports Core failures", async () => {
	let method = "";
	globalThis.fetch = ((_url: string | URL, init?: RequestInit) => {
		method = String(init?.method);
		return Promise.resolve(
			new Response(JSON.stringify({ success: true, removed: true }), {
				status: 200,
			})
		);
	}) as typeof fetch;
	await expect(deleteConversation(target, "conversation-1")).resolves.toBe(
		true
	);
	expect(method).toBe("DELETE");

	globalThis.fetch = (() =>
		Promise.resolve(
			new Response("", { status: 403 })
		)) as unknown as typeof fetch;
	await expect(deleteConversation(target, "conversation-1")).rejects.toThrow(
		"Delete conversation failed: 403"
	);
});
