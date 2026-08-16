import { afterEach, expect, test } from "bun:test";
import type { ApiTarget } from "@ryuhq/core-client/client";
import {
	parseChatPermission,
	permissionToolTitle,
	respondToChatPermission,
} from "../core/chatPermission.ts";

const target: ApiTarget = { url: "http://node:7980", token: "node-secret" };
const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

test("parses the Core ryu-permission frame and preserves tool metadata", () => {
	const permission = parseChatPermission({
		requestId: "perm-7",
		toolCall: { fields: { title: "Run shell" } },
		options: [
			{ kind: "allow_once", name: "Allow once", optionId: "allow" },
			{ kind: "reject_once", name: "Reject", optionId: "reject" },
		],
	});

	expect(permission?.requestId).toBe("perm-7");
	expect(permission?.options).toHaveLength(2);
	expect(permissionToolTitle(permission?.toolCall)).toBe("Run shell");
});

test("rejects malformed permission frames", () => {
	expect(parseChatPermission(null)).toBeNull();
	expect(parseChatPermission({ requestId: "perm-7", options: [] })).toBeNull();
	expect(
		parseChatPermission({
			requestId: "perm-7",
			options: [{ name: "Allow", optionId: "allow" }],
		})
	).toBeNull();
});

test("posts the selected option to Core's permission contract", async () => {
	let captured: { body?: string; headers?: HeadersInit; url?: string } = {};
	globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
		captured = {
			body: init?.body as string,
			headers: init?.headers,
			url: String(url),
		};
		return Promise.resolve(
			new Response(JSON.stringify({ resolved: true }), {
				headers: { "Content-Type": "application/json" },
				status: 200,
			})
		);
	}) as unknown as typeof fetch;

	expect(await respondToChatPermission(target, "perm-7", "allow")).toBe(true);
	expect(captured.url).toBe("http://node:7980/api/chat/permission");
	expect(JSON.parse(captured.body ?? "{}")).toEqual({
		request_id: "perm-7",
		option_id: "allow",
	});
	const headers = new Headers(captured.headers);
	expect(headers.get("Authorization")).toBe("Bearer node-secret");
});
