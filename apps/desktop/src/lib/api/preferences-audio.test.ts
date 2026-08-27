import { describe, expect, it } from "bun:test";
import {
	getPreference,
	setPreference,
	subscribePreferenceChanges,
} from "./preferences.ts";

function mockFetch(response: () => Response): typeof fetch {
	const originalFetch = globalThis.fetch;
	return Object.assign(async () => response(), {
		preconnect: originalFetch.preconnect,
	});
}

describe("preference change notifications", () => {
	it("notifies in-process consumers after a successful save", async () => {
		const originalFetch = globalThis.fetch;
		const notifications: [string, string][] = [];
		const unsubscribe = subscribePreferenceChanges((key, value) => {
			notifications.push([key, value]);
		});

		try {
			globalThis.fetch = Object.assign(
				async () =>
					new Response(JSON.stringify({ ok: true }), {
						headers: { "content-type": "application/json" },
						status: 200,
					}),
				{ preconnect: originalFetch.preconnect }
			);

			expect(
				await setPreference(
					{ token: null, url: "http://ryu.test" },
					"ambient-elevator-enabled",
					"false"
				)
			).toBe(true);
			expect(notifications).toEqual([["ambient-elevator-enabled", "false"]]);
		} finally {
			unsubscribe();
			globalThis.fetch = originalFetch;
		}
	});

	it("returns null only for a missing preference", async () => {
		const originalFetch = globalThis.fetch;
		try {
			globalThis.fetch = mockFetch(
				() => new Response('{"error":"missing"}', { status: 404 })
			);
			expect(
				await getPreference(
					{ token: null, url: "http://ryu.test" },
					"missing-key"
				)
			).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("preserves read and write failures", async () => {
		const originalFetch = globalThis.fetch;
		try {
			globalThis.fetch = mockFetch(
				() => new Response('{"error":"forbidden"}', { status: 403 })
			);
			await expect(
				getPreference({ token: null, url: "http://ryu.test" }, "protected-key")
			).rejects.toMatchObject({ status: 403 });
			await expect(
				setPreference(
					{ token: null, url: "http://ryu.test" },
					"protected-key",
					"value"
				)
			).rejects.toMatchObject({ status: 403 });
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
