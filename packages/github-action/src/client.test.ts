import { describe, expect, it } from "bun:test";
import { type FetchLike, RyuHttpError, RyuNodeClient } from "./client.ts";

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		headers: { "content-type": "application/json" },
		status,
	});
}

function streamResponse(chunks: string[]): Response {
	const encoder = new TextEncoder();
	return new Response(
		new ReadableStream({
			start(controller) {
				for (const chunk of chunks) {
					controller.enqueue(encoder.encode(chunk));
				}
				controller.close();
			},
		})
	);
}

const target = {
	mode: "self-hosted" as const,
	token: "client-secret",
	url: "https://node.example",
};

describe("Ryu Core HTTP client", () => {
	it("retries a transient health failure and validates system info", async () => {
		let healthAttempts = 0;
		const paths: string[] = [];
		const fetchImpl: FetchLike = async (input) => {
			const path = new URL(String(input)).pathname;
			paths.push(path);
			if (path === "/api/health") {
				healthAttempts += 1;
				if (healthAttempts === 1) {
					throw new Error("temporary socket close");
				}
				return jsonResponse({ status: "ok", version: "1.2.3" });
			}
			return jsonResponse({ managed: true, org_id: "org-1" });
		};

		const snapshot = await new RyuNodeClient(target, fetchImpl).validate(
			"auto",
			1000
		);

		expect(healthAttempts).toBe(2);
		expect(paths).toEqual(["/api/health", "/api/health", "/api/system/info"]);
		expect(snapshot.info).toMatchObject({ managed: true, orgId: "org-1" });
	});

	it("sends the chat contract and parses a streaming response", async () => {
		let capturedBody: unknown;
		let capturedHeaders: Headers | undefined;
		const fetchImpl: FetchLike = async (_input, init) => {
			capturedBody = JSON.parse(String(init?.body));
			capturedHeaders = new Headers(init?.headers);
			return streamResponse([
				'data: {"type":"text-delta","delta":"ok"}\n',
				'data: {"type":"finish"}\n',
				"data: [DONE]\n",
			]);
		};

		const result = await new RyuNodeClient(target, fetchImpl).runChat(
			{
				agent_id: "agent-1",
				conversation_id: "conversation-1",
				enable_long_term: false,
				messages: [
					{
						content: [{ text: "hi", type: "text" }],
						role: "user",
					},
				],
				persist: false,
			},
			1000
		);

		expect(capturedBody).toMatchObject({
			agent_id: "agent-1",
			conversation_id: "conversation-1",
			persist: false,
		});
		expect(capturedHeaders?.get("authorization")).toBe("Bearer client-secret");
		expect(capturedHeaders?.get("accept")).toBe("text/event-stream");
		expect(result).toMatchObject({
			conversationId: "conversation-1",
			finished: true,
			text: "ok",
		});
	});

	it("rejects a chat stream that closes without a completion frame", async () => {
		const fetchImpl: FetchLike = async () =>
			streamResponse(['data: {"type":"text-delta","delta":"partial"}\n']);

		const error = await new RyuNodeClient(target, fetchImpl)
			.runChat(
				{
					conversation_id: "conversation-1",
					enable_long_term: false,
					messages: [
						{
							content: [{ text: "hi", type: "text" }],
							role: "user",
						},
					],
					persist: false,
				},
				1000
			)
			.catch((value: unknown) => value);

		expect(String(error)).toContain("ended before a completion frame");
	});

	it("sends tool calls and redacts bearer tokens from HTTP errors", async () => {
		let capturedBody: unknown;
		const fetchImpl: FetchLike = async (_input, init) => {
			capturedBody = JSON.parse(String(init?.body));
			return jsonResponse({ message: "client-secret was rejected" }, 401);
		};

		const error = await new RyuNodeClient(target, fetchImpl)
			.callTool(
				{
					agent_id: "agent-1",
					arguments: { query: "hi" },
					tool: "search",
				},
				1000
			)
			.catch((value: unknown) => value);

		expect(capturedBody).toEqual({
			agent_id: "agent-1",
			arguments: { query: "hi" },
			tool: "search",
		});
		expect(error).toBeInstanceOf(RyuHttpError);
		expect(String(error)).toContain("[REDACTED]");
		expect(String(error)).not.toContain("client-secret");
	});

	it("redacts tokens surfaced by a chat stream error frame", async () => {
		const fetchImpl: FetchLike = async () =>
			streamResponse([
				'data: {"type":"error","errorText":"client-secret leaked by node"}\n',
			]);

		const error = await new RyuNodeClient(target, fetchImpl)
			.runChat(
				{
					conversation_id: "conversation-1",
					enable_long_term: false,
					messages: [
						{
							content: [{ text: "hi", type: "text" }],
							role: "user",
						},
					],
					persist: false,
				},
				1000
			)
			.catch((value: unknown) => value);

		expect(String(error)).toContain("[REDACTED]");
		expect(String(error)).not.toContain("client-secret");
	});

	it("fails a request when the fetch promise does not resolve before timeout", async () => {
		const fetchImpl: FetchLike = (_input, init) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					reject(new Error("aborted"));
				});
			});

		await expect(
			new RyuNodeClient(target, fetchImpl).callTool(
				{
					agent_id: "agent-1",
					arguments: {},
					tool: "slow",
				},
				20
			)
		).rejects.toThrow("timed out after 20ms");
	});

	it("keeps the timeout active while a chat response body is stalled", async () => {
		const fetchImpl: FetchLike = async (_input, init) => {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					init?.signal?.addEventListener("abort", () => {
						controller.error(new Error("aborted"));
					});
				},
			});
			return new Response(body);
		};

		await expect(
			new RyuNodeClient(target, fetchImpl).runChat(
				{
					conversation_id: "conversation-1",
					enable_long_term: false,
					messages: [
						{
							content: [{ text: "hi", type: "text" }],
							role: "user",
						},
					],
					persist: false,
				},
				20
			)
		).rejects.toThrow("timed out after 20ms");
	});

	it("keeps the timeout active while a JSON response body is stalled", async () => {
		const fetchImpl: FetchLike = async (_input, init) => {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					init?.signal?.addEventListener("abort", () => {
						controller.error(new Error("aborted"));
					});
				},
			});
			return new Response(body, {
				headers: { "content-type": "application/json" },
			});
		};

		await expect(
			new RyuNodeClient(target, fetchImpl).callTool(
				{
					agent_id: "agent-1",
					arguments: {},
					tool: "slow",
				},
				20
			)
		).rejects.toThrow("timed out after 20ms");
	});
});
