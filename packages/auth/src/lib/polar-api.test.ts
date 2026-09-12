import { expect, test } from "bun:test";
import {
	POLAR_API_VERSION,
	polarRequestInit,
	withPolarApiVersion,
} from "./polar-api.ts";

test("pins Polar headers to the stable API contract", () => {
	const headers = withPolarApiVersion({
		"Polar-Version": "2026-10",
		"X-Request-Id": "request-1",
	});

	expect(headers.get("Polar-Version")).toBe(POLAR_API_VERSION);
	expect(headers.get("X-Request-Id")).toBe("request-1");
});

test("builds authenticated direct requests with the same API pin", () => {
	const requestInit = polarRequestInit("polar-test-token", {
		method: "POST",
		headers: { "Polar-Version": "2027-01" },
		body: JSON.stringify({ name: "test" }),
	});
	const headers = new Headers(requestInit.headers);

	expect(headers.get("Authorization")).toBe("Bearer polar-test-token");
	expect(headers.get("Content-Type")).toBe("application/json");
	expect(headers.get("Polar-Version")).toBe(POLAR_API_VERSION);
	expect(requestInit.method).toBe("POST");
});
