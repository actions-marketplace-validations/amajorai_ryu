import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof localStorage === "undefined") {
	GlobalRegistrator.register();
}

const getRealtimeJwt = mock(async () => "verified-user-jwt");
mock.module("@/src/lib/realtime/jwt.ts", () => ({ getRealtimeJwt }));

const { authenticatedFetch, USER_JWT_HEADER } = await import("./client.ts");

const originalFetch = globalThis.fetch;
interface FetchCall {
	init?: RequestInit;
	input: RequestInfo | URL;
}
const fetchCalls: FetchCall[] = [];
const fetchMock = mock(
	async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		fetchCalls.push({ init, input });
		return new Response("ok", { status: 200 });
	}
);
Reflect.set(globalThis, "fetch", fetchMock);

const TARGET = { token: "node-secret", url: "https://node.example/" };

function lastCall(): FetchCall {
	const call = fetchCalls.at(-1);
	if (!call) {
		throw new Error("Expected an authenticated fetch call");
	}
	return call;
}

function lastHeaders(): Headers {
	return new Headers(lastCall().init?.headers);
}

afterAll(() => {
	Reflect.set(globalThis, "fetch", originalFetch);
});

beforeEach(() => {
	fetchCalls.length = 0;
	getRealtimeJwt.mockClear();
	localStorage.clear();
	localStorage.setItem("ryu_client_id", "desktop-client-1");
	localStorage.setItem(
		"ryu_oidc_user",
		JSON.stringify({ email: "person@example.com", name: "Ryu User" })
	);
});

describe("authenticatedFetch", () => {
	test("keeps an encoded JSON body and sends node plus verified user identity", async () => {
		const body = JSON.stringify({ enabled: true });
		await authenticatedFetch(TARGET, "/api/config", {
			body,
			headers: { "X-Request-Kind": "json" },
			method: "POST",
		});

		expect(String(lastCall().input)).toBe("https://node.example/api/config");
		expect(lastCall().init?.body).toBe(body);
		const headers = lastHeaders();
		expect(headers.get("Authorization")).toBe("Bearer node-secret");
		expect(headers.get(USER_JWT_HEADER)).toBe("verified-user-jwt");
		expect(headers.get("X-Ryu-Client-Id")).toBe("desktop-client-1");
		expect(headers.get("X-Ryu-Client-Label")).toBe("Desktop");
		expect(headers.get("X-Ryu-Surface")).toBe("desktop");
		expect(headers.get("X-Ryu-User-Id")).toBe("person%40example.com");
		expect(headers.get("X-Ryu-User-Name")).toBe("Ryu%20User");
		expect(headers.get("Content-Type")).toBe("application/json");
		expect(headers.get("X-Request-Kind")).toBe("json");
	});

	test("passes FormData through and lets the browser own its content type", async () => {
		const form = new FormData();
		form.set("file", new Blob(["content"]), "document.txt");
		await authenticatedFetch(TARGET, "/api/uploads", {
			body: form,
			headers: { "Content-Type": undefined },
			method: "POST",
		});

		expect(lastCall().init?.body).toBe(form);
		expect(lastHeaders().has("Content-Type")).toBe(false);
		expect(lastHeaders().get(USER_JWT_HEADER)).toBe("verified-user-jwt");
	});

	test("passes a binary body through without changing its declared media type", async () => {
		const bytes = new Blob([new Uint8Array([1, 2, 3])]);
		await authenticatedFetch(TARGET, "/api/binary", {
			body: bytes,
			headers: { "Content-Type": "application/octet-stream" },
			method: "PUT",
		});

		expect(lastCall().init?.body).toBe(bytes);
		expect(lastHeaders().get("Content-Type")).toBe("application/octet-stream");
		expect(lastHeaders().get(USER_JWT_HEADER)).toBe("verified-user-jwt");
	});

	test("preserves stream options and refuses auth or identity overrides", async () => {
		const controller = new AbortController();
		await authenticatedFetch(TARGET, "/api/events/all", {
			cache: "no-store",
			headers: {
				Accept: "text/event-stream",
				Authorization: "Bearer attacker",
				"content-type": null,
				[USER_JWT_HEADER]: "forged-user-jwt",
				"X-Ryu-Client-Id": "forged-client",
			},
			method: "GET",
			signal: controller.signal,
		});

		expect(lastCall().init?.cache).toBe("no-store");
		expect(lastCall().init?.signal).toBe(controller.signal);
		const headers = lastHeaders();
		expect(headers.get("Accept")).toBe("text/event-stream");
		expect(headers.has("Content-Type")).toBe(false);
		expect(headers.get("Authorization")).toBe("Bearer node-secret");
		expect(headers.get(USER_JWT_HEADER)).toBe("verified-user-jwt");
		expect(headers.get("X-Ryu-Client-Id")).toBe("desktop-client-1");
	});
});
