import { describe, expect, it } from "bun:test";
import { decideSeatAdmission } from "./organization-seat-gate.ts";

describe("organization Teams seat admission", () => {
	it("allows a claim while a seat is free", () => {
		expect(
			decideSeatAdmission({
				billedSeats: 5,
				memberCount: 4,
				reservedSeatCount: 0,
			})
		).toEqual({ allowed: true });
	});

	it("blocks the last seat when another acceptance is in flight", () => {
		expect(
			decideSeatAdmission({
				billedSeats: 5,
				memberCount: 4,
				reservedSeatCount: 1,
			})
		).toEqual({
			allowed: false,
			reason:
				"No unassigned Teams seat is available. Ask an organization owner or admin to add a seat first.",
		});
	});

	it("never permits members to exceed the billed quantity", () => {
		expect(
			decideSeatAdmission({
				billedSeats: 5,
				memberCount: 6,
				reservedSeatCount: 0,
			})
		).toMatchObject({ allowed: false });
	});
});
