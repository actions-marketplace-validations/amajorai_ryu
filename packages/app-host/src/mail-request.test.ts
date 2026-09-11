import { describe, expect, test } from "bun:test";
import { asMailRequestArg } from "./rpc.ts";

describe("mail.request validator", () => {
	test("accepts declared mail resource paths and preserves JSON bodies", () => {
		expect(
			asMailRequestArg({
				body: { eventTypes: ["message.received"] },
				method: "POST",
				path: "/api/mail/webhooks",
			})
		).toEqual({
			body: { eventTypes: ["message.received"] },
			method: "POST",
			path: "/api/mail/webhooks",
		});
	});

	test("rejects traversal, public callbacks, and unsupported methods", () => {
		expect(
			asMailRequestArg({ path: "/api/mail/inbound/in-1", method: "POST" })
		).toBeNull();
		expect(asMailRequestArg({ path: "/api/mail/track/m-1" })).toBeNull();
		expect(asMailRequestArg({ path: "/api/mail/../secrets" })).toBeNull();
		expect(
			asMailRequestArg({ method: "PUT", path: "/api/mail/inboxes" })
		).toBeNull();
	});
});
