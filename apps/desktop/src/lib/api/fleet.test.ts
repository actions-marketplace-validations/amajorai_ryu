import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	bindSelfHostedNodeToOrganization,
	getFleetBindingStatus,
	NodeAlreadyBoundError,
	parseFleetBindingStatus,
} from "./fleet.ts";

const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const target = { token: "local-core-token", url: "http://127.0.0.1:7980" };
const validEnrollmentToken = `rfe_${"a".repeat(64)}`;

beforeEach(() => {
	globalThis.localStorage = {
		getItem: () => "account-session",
	} as unknown as Storage;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	globalThis.localStorage = originalStorage;
	globalThis.setTimeout = originalSetTimeout;
	globalThis.clearTimeout = originalClearTimeout;
});

describe("Fleet organization binding", () => {
	test("issues one org-scoped code and hands it directly to the active Core", async () => {
		const requests: Array<{
			body: string;
			signal: AbortSignal | null | undefined;
			url: string;
		}> = [];
		let statusReads = 0;
		globalThis.fetch = (async (input, init) => {
			const url = String(input);
			requests.push({
				body: String(init?.body ?? ""),
				signal: init?.signal,
				url,
			});
			if (url.endsWith("/api/fleet/status")) {
				statusReads += 1;
				return Response.json(
					statusReads === 1
						? { enrolled: false }
						: {
								enrolled: true,
								managedInferenceReady: true,
								nodeId: "node-1",
								organizationId: "org-1",
								organizationName: "Acme",
							}
				);
			}
			if (url.includes("/nodes/enrollment-tokens")) {
				return Response.json({
					expiresAt: "2030-01-01T00:10:00.000Z",
					token: validEnrollmentToken,
				});
			}
			return Response.json({ nodeId: "node-1", organizationId: "org-1" });
		}) as typeof globalThis.fetch;

		await expect(
			bindSelfHostedNodeToOrganization({
				name: "Studio workstation",
				organizationId: "org-1",
				target,
			})
		).resolves.toMatchObject({
			enrolled: true,
			managedInferenceReady: true,
			nodeId: "node-1",
			organizationId: "org-1",
		});
		const enrollmentRequests = requests.filter(
			(request) => !request.url.endsWith("/api/auth/token")
		);
		expect(enrollmentRequests.map((request) => request.url)).toEqual([
			"http://127.0.0.1:7980/api/fleet/status",
			expect.stringContaining(
				"/api/control-plane/orgs/org-1/nodes/enrollment-tokens"
			),
			"http://127.0.0.1:7980/api/fleet/enroll",
			"http://127.0.0.1:7980/api/fleet/status",
		]);
		expect(
			enrollmentRequests.every(
				(request) => request.signal instanceof AbortSignal
			)
		).toBe(true);
		expect(JSON.parse(enrollmentRequests[1]?.body ?? "{}")).toEqual({
			kind: "byod",
			name: "Studio workstation",
		});
		expect(JSON.parse(enrollmentRequests[2]?.body ?? "{}")).toEqual({
			controlPlaneUrl: expect.any(String),
			token: validEnrollmentToken,
		});
	});

	test("rejects a malformed cloud token before sending it to Core", async () => {
		const requestedUrls: string[] = [];
		globalThis.fetch = (async (input) => {
			const url = String(input);
			requestedUrls.push(url);
			if (url.endsWith("/api/fleet/status")) {
				return Response.json({ enrolled: false });
			}
			if (url.includes("/nodes/enrollment-tokens")) {
				return Response.json({ token: "rfe_not-a-real-code" });
			}
			return Response.json({});
		}) as typeof globalThis.fetch;

		await expect(
			bindSelfHostedNodeToOrganization({
				name: "Studio workstation",
				organizationId: "org-1",
				target,
			})
		).rejects.toThrow("invalid enrollment code");
		expect(
			requestedUrls.filter((url) => url.endsWith("/api/fleet/enroll"))
		).toHaveLength(0);
	});

	test("rejects a trimmed node name longer than 128 characters before fetching", async () => {
		let requestCount = 0;
		globalThis.fetch = (async (_input, _init) => {
			requestCount += 1;
			return Response.json({ enrolled: false });
		}) as typeof globalThis.fetch;

		await expect(
			bindSelfHostedNodeToOrganization({
				name: `  ${"n".repeat(129)}  `,
				organizationId: "org-1",
				target,
			})
		).rejects.toThrow("128 characters");
		expect(requestCount).toBe(0);
	});

	test("never issues a new code for an already-bound node", async () => {
		const requestedUrls: string[] = [];
		globalThis.fetch = (async (input) => {
			requestedUrls.push(String(input));
			return Response.json({
				enrolled: true,
				managedInferenceReady: true,
				nodeId: "node-1",
				organizationId: "org-existing",
				organizationName: "Existing org",
			});
		}) as typeof globalThis.fetch;

		await expect(
			bindSelfHostedNodeToOrganization({
				name: "Studio workstation",
				organizationId: "org-new",
				target,
			})
		).rejects.toBeInstanceOf(NodeAlreadyBoundError);
		expect(
			requestedUrls.filter((url) => url.includes("/nodes/enrollment-tokens"))
		).toHaveLength(0);
	});

	test("rejects an incomplete enrolled status at the network boundary", () => {
		expect(() =>
			parseFleetBindingStatus({ enrolled: true, organizationId: "org-1" })
		).toThrow("nodeId");
	});

	test("aborts a blackholed Core status request and clears its timer", async () => {
		globalThis.localStorage = {
			getItem: () => null,
		} as unknown as Storage;
		let clearedTimers = 0;
		globalThis.setTimeout = ((handler: TimerHandler) => {
			if (typeof handler === "function") {
				handler();
			}
			return 1;
		}) as typeof globalThis.setTimeout;
		globalThis.clearTimeout = (() => {
			clearedTimers += 1;
		}) as typeof globalThis.clearTimeout;
		globalThis.fetch = (async (_input, init) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					reject(new DOMException("aborted", "AbortError"));
				});
				if (init?.signal?.aborted) {
					reject(new DOMException("aborted", "AbortError"));
				}
			})) as typeof globalThis.fetch;

		const result = await Promise.race([
			getFleetBindingStatus(target).then(
				() => "resolved",
				(error: unknown) =>
					error instanceof Error ? error.message : "unknown error"
			),
			new Promise<string>((resolve) =>
				originalSetTimeout(() => resolve("still pending"), 100)
			),
		]);

		expect(result).toContain("timed out");
		expect(clearedTimers).toBe(1);
	});
});
