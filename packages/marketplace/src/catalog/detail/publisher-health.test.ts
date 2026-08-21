import { describe, expect, test } from "bun:test";
import { calculatePublisherHealth } from "./publisher-health.ts";

describe("calculatePublisherHealth", () => {
	test("keeps an unverified unsigned listing visibly risky", () => {
		const health = calculatePublisherHealth({
			publisherTrust: "dotted",
			reviewed: false,
			signatureStatus: "unsigned",
		});
		expect(health.score).toBeLessThan(40);
		expect(health.signals).toContainEqual({
			label: "Publisher identity",
			status: "warning",
			value: "Not verified",
		});
	});

	test("rewards independent evidence without implying endorsement", () => {
		const health = calculatePublisherHealth({
			publisherTrust: "blue",
			reviewed: true,
			signatureStatus: "verified",
			packageChecksum: "sha256:abc",
		});
		expect(health.score).toBeGreaterThan(70);
		expect(
			health.signals.some(
				(signal) => signal.value === "Stripe identity verified"
			)
		).toBe(true);
	});
});
