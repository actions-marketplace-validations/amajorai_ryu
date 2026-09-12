import { describe, expect, it } from "bun:test";
import {
	isGrantUsable,
	isSupportAccessRequestAllowed,
	normalizeScopes,
	resolveGrantExpiry,
	supportAccessScopeForRequest,
} from "./support-access.ts";

describe("support access policy helpers", () => {
	it("keeps only known, unique scopes", () => {
		expect(
			normalizeScopes([" billing ", "billing", "unknown", "marketplace"])
		).toEqual(["billing", "marketplace"]);
	});

	it("clamps grants to the one-hour maximum", () => {
		const now = new Date("2026-08-19T00:00:00.000Z");
		expect(resolveGrantExpiry(10, now).toISOString()).toBe(
			"2026-08-19T00:10:00.000Z"
		);
		expect(resolveGrantExpiry(120, now).toISOString()).toBe(
			"2026-08-19T01:00:00.000Z"
		);
		expect(resolveGrantExpiry(0, now).toISOString()).toBe(
			"2026-08-19T01:00:00.000Z"
		);
	});

	it("requires active status and a future expiry", () => {
		const now = new Date("2026-08-19T00:00:00.000Z");
		expect(
			isGrantUsable(
				{ status: "active", expiresAt: "2026-08-19T00:01:00.000Z" },
				now
			)
		).toBe(true);
		expect(
			isGrantUsable(
				{ status: "active", expiresAt: "2026-08-18T23:59:00.000Z" },
				now
			)
		).toBe(false);
		expect(
			isGrantUsable(
				{ status: "revoked", expiresAt: "2026-08-19T00:01:00.000Z" },
				now
			)
		).toBe(false);
	});

	it("allows only exact read routes for the matching diagnostic scope", () => {
		expect(
			supportAccessScopeForRequest("/api/support-access/diagnostics/billing")
		).toBe("billing");
		expect(
			isSupportAccessRequestAllowed(
				"/api/support-access/diagnostics/billing",
				"GET",
				["billing"]
			)
		).toBe(true);
		expect(
			isSupportAccessRequestAllowed(
				"/api/support-access/diagnostics/billing",
				"POST",
				["billing"]
			)
		).toBe(false);
		expect(
			isSupportAccessRequestAllowed("/api/channels/customer-config", "GET", [
				"channels",
			])
		).toBe(false);
		expect(
			isSupportAccessRequestAllowed("/api/marketplace/marketplaces", "GET", [
				"marketplace",
			])
		).toBe(false);
		expect(
			supportAccessScopeForRequest("/api/marketplace/catalog/detail", "GET")
		).toBeNull();
	});
});
