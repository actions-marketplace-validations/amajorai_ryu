import { describe, expect, it } from "bun:test";
import { setPreference, subscribePreferenceChanges } from "./preferences.ts";

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
});
