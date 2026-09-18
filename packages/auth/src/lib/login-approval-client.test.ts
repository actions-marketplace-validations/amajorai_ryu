import { afterEach, describe, expect, it } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:net";
import {
	approveLoginApproval,
	listLoginApprovals,
	pollLoginApprovalSession,
	startLoginApproval,
	streamLoginApprovals,
} from "./login-approval-client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const request = {
	clientId: "ryu-desktop",
	createdAt: "2026-09-03T00:00:00.000Z",
	deviceLabel: "Ryu Desktop",
	expiresAt: "2026-09-03T00:05:00.000Z",
	id: "request-1",
	ipAddress: null,
	status: "pending" as const,
	surface: "desktop" as const,
	userAgent: "Ryu Desktop Test",
	userCode: "ABCD2345",
};

describe("login approval client", () => {
	it("maps the server start response into the shared client contract", async () => {
		globalThis.fetch = async () =>
			Response.json({
				deviceCode: "device-secret",
				expiresIn: 300,
				interval: 5,
				requestId: "request-1",
				status: "pending",
				userCode: "ABCD2345",
				verificationUri: "https://app.example/device",
				verificationUriComplete:
					"https://app.example/device?user_code=ABCD2345",
			});

		await expect(
			startLoginApproval("https://api.example", "ryu-desktop", {
				deviceLabel: "Ryu Desktop",
				email: "ada@example.com",
			})
		).resolves.toEqual({
			deviceCode: "device-secret",
			expiresIn: 300,
			interval: 5,
			requestId: "request-1",
			userCode: "ABCD2345",
			verificationUri: "https://app.example/device",
			verificationUriComplete: "https://app.example/device?user_code=ABCD2345",
		});
	});

	it("lists and approves only the parsed request shape", async () => {
		const calls: Request[] = [];
		globalThis.fetch = async (input, init) => {
			calls.push(new Request(input, init));
			if (calls.length === 1) {
				return Response.json({ requests: [request] });
			}
			return Response.json({ ok: true, status: "approved" });
		};

		await expect(
			listLoginApprovals("https://api.example", { token: "session-token" })
		).resolves.toEqual([request]);
		await expect(
			approveLoginApproval("https://api.example", "request-1", {
				token: "session-token",
			})
		).resolves.toBeUndefined();

		expect(calls[0]?.headers.get("authorization")).toBe("Bearer session-token");
		expect(calls[1]?.url).toBe(
			"https://api.example/api/login-approvals/pending/request-1/approve"
		);
	});

	it("parses an SSE snapshot and live approval event", async () => {
		const resolved = {
			requestId: "request-1",
			type: "approved" as const,
		};
		const body = [
			`event: login-approval\ndata: ${JSON.stringify({ request, type: "created" })}`,
			`event: login-approval\ndata: ${JSON.stringify(resolved)}`,
		].join("\n\n");
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(`${body}\n\n`));
				controller.close();
			},
		});
		globalThis.fetch = async () =>
			new Response(stream, {
				headers: { "Content-Type": "text/event-stream" },
			});
		const events: unknown[] = [];

		await streamLoginApprovals("https://api.example", {}, (event) => {
			events.push(event);
		});

		expect(events).toEqual([{ request, type: "created" }, resolved]);
		expect(stream.locked).toBe(false);
	});

	it("polls the browser session endpoint with the device grant", async () => {
		const calls: Request[] = [];
		globalThis.fetch = async (input, init) => {
			calls.push(new Request(input, init));
			return Response.json({ ok: true, expires_in: 300 });
		};

		await pollLoginApprovalSession("https://app.example", "ryu-web", {
			deviceCode: "device-secret",
			expiresIn: 300,
			interval: 1,
			requestId: "request-1",
			userCode: "ABCD2345",
			verificationUri: "https://app.example/device",
			verificationUriComplete: "https://app.example/device?user_code=ABCD2345",
		});

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://app.example/api/auth/device/session");
		expect(calls[0]?.credentials).toBe("include");
		expect(await calls[0]?.json()).toEqual({
			client_id: "ryu-web",
			device_code: "device-secret",
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
		});
	});
});

it("cancels pending approval reads before headers and during the response body", async () => {
	for (const sendHeaders of [false, true]) {
		let received!: () => void;
		const entered = new Promise<void>((resolve) => {
			received = resolve;
		});
		let disconnected!: () => void;
		const closed = new Promise<void>((resolve) => {
			disconnected = resolve;
		});
		const sockets = new Set<import("node:net").Socket>();
		const server = createServer((socket) => {
			sockets.add(socket);
			socket.once("close", () => {
				sockets.delete(socket);
				disconnected();
			});
			socket.once("data", () => {
				if (sendHeaders) {
					socket.write(
						'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"requests":['
					);
				}
				received();
			});
		});
		const listening = once(server, "listening");
		server.listen(0, "127.0.0.1");
		await listening;
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Expected TCP listener");
		}
		const controller = new AbortController();
		let bodyStarted!: () => void;
		const readingBody = new Promise<void>((resolve) => {
			bodyStarted = resolve;
		});
		if (sendHeaders) {
			globalThis.fetch = async (input, init) => {
				const response = await originalFetch(input, init);
				const json = response.json.bind(response);
				response.json = () => {
					const pending = json();
					bodyStarted();
					return pending;
				};
				return response;
			};
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		const deadline = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(
				() => reject(new Error("Cancellation timed out")),
				2000
			);
		});
		try {
			const pending = listLoginApprovals(
				`http://127.0.0.1:${address.port}`,
				{},
				controller.signal
			);
			const rejected = pending.then(
				() => null,
				(error: unknown) => error
			);
			await Promise.race([entered, deadline]);
			if (sendHeaders) {
				await Promise.race([readingBody, deadline]);
			}
			controller.abort();
			expect(await Promise.race([rejected, deadline])).toBeInstanceOf(Error);
			await Promise.race([closed, deadline]);
			expect(controller.signal.aborted).toBe(true);
		} finally {
			clearTimeout(timer);
			globalThis.fetch = originalFetch;
			controller.abort();
			for (const socket of sockets) {
				socket.destroy();
			}
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve()))
			);
		}
	}
});

it("releases the stream when its event consumer throws", async () => {
	let cancelled = 0;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(
				new TextEncoder().encode(
					'data: {"type":"approved","requestId":"fixture"}\n\n'
				)
			);
		},
		cancel() {
			cancelled += 1;
		},
	});
	globalThis.fetch = async () => new Response(body);
	await expect(
		streamLoginApprovals("https://api.example", {}, () => {
			throw new Error("Consumer stopped");
		})
	).rejects.toThrow("Consumer stopped");
	expect(cancelled).toBe(1);
	expect(body.locked).toBe(false);
});

it("stops buffered events and releases its reader when the consumer aborts", async () => {
	let cancelled = 0;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(
				new TextEncoder().encode(
					'data: {"type":"approved","requestId":"first"}\n\ndata: {"type":"approved","requestId":"second"}\n\n'
				)
			);
		},
		cancel() {
			cancelled += 1;
		},
	});
	globalThis.fetch = async () => new Response(body);
	const controller = new AbortController();
	const events: unknown[] = [];
	await streamLoginApprovals(
		"https://api.example",
		{},
		(event) => {
			events.push(event);
			controller.abort();
		},
		controller.signal
	);
	expect(events).toEqual([{ type: "approved", requestId: "first" }]);
	expect(cancelled).toBe(1);
	expect(body.locked).toBe(false);
});
