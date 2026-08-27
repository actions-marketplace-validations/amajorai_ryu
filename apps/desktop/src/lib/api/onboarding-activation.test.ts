import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	claimActivationReward,
	saveOnboardingSource,
} from "./onboarding-activation.ts";

const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;

describe("onboarding activation API", () => {
	beforeEach(() => {
		globalThis.localStorage = {
			getItem: () => "test-token",
		} as unknown as Storage;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		globalThis.localStorage = originalStorage;
	});

	test("sends the acquisition source through the account route", async () => {
		let request: RequestInit | undefined;
		globalThis.fetch = (async (_input, init) => {
			request = init;
			return Response.json({ source: "podcast" });
		}) as typeof globalThis.fetch;

		await saveOnboardingSource("podcast");

		expect(request?.method).toBe("PATCH");
		expect(request?.body).toBe(JSON.stringify({ source: "podcast" }));
	});

	test("returns the server reward without accepting a client amount", async () => {
		let requestBody = "";
		globalThis.fetch = (async (_input, init) => {
			requestBody = String(init?.body ?? "");
			return Response.json({
				amountMicroUsd: 500_000,
				completed: 1,
				granted: true,
				remaining: 19,
			});
		}) as typeof globalThis.fetch;

		await expect(
			claimActivationReward({ appSlug: "chorus", connectionId: "connection-1" })
		).resolves.toEqual({
			amountMicroUsd: 500_000,
			completed: 1,
			granted: true,
			remaining: 19,
		});
		expect(requestBody).toBe(
			JSON.stringify({ appSlug: "chorus", connectionId: "connection-1" })
		);
	});
});
