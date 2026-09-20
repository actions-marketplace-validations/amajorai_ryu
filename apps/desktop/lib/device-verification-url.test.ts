import { describe, expect, test } from "bun:test";
import { localizeDevVerificationUrl } from "./device-verification-url.ts";

describe("device verification destination", () => {
	test("keeps local development activation on the configured frontend", () => {
		expect(
			localizeDevVerificationUrl(
				"https://ryuhq.com/device?user_code=TEST1234#approve",
				"http://localhost:3001",
				true
			)
		).toBe("http://localhost:3001/device?user_code=TEST1234#approve");
	});

	test("supports IPv4 and IPv6 loopback frontend origins", () => {
		for (const origin of ["http://127.0.0.1:3001", "http://[::1]:3001"]) {
			expect(
				localizeDevVerificationUrl("https://example.test/device", origin, true)
			).toBe(`${origin}/device`);
		}
	});

	test("preserves provider URLs in release builds and explicit remote development", () => {
		const supplied = "https://auth.example.test/device?user_code=TEST1234";
		expect(
			localizeDevVerificationUrl(supplied, "http://localhost:3001", false)
		).toBe(supplied);
		expect(
			localizeDevVerificationUrl(supplied, "https://staging.example.test", true)
		).toBe(supplied);
	});

	test("preserves already-local and relative verification links", () => {
		for (const supplied of [
			"http://localhost:3001/device?user_code=TEST1234",
			"/device?user_code=TEST1234",
		]) {
			expect(
				localizeDevVerificationUrl(supplied, "http://localhost:3001", true)
			).toBe(supplied);
		}
	});
});
