import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	formatVerificationDate,
	VerificationPopover,
} from "./verification-popover.tsx";

describe("formatVerificationDate", () => {
	test("formats valid ISO dates with a stable UTC calendar date", () => {
		expect(formatVerificationDate("2026-08-26T23:30:00.000Z")).toBe(
			"Aug 26, 2026"
		);
	});

	test("does not render a date for missing or invalid input", () => {
		expect(formatVerificationDate()).toBeNull();
		expect(formatVerificationDate(null)).toBeNull();
		expect(formatVerificationDate("not-a-date")).toBeNull();
	});
});

describe("VerificationPopover", () => {
	test("uses a real accessible button for both mark variants", () => {
		const badge = renderToStaticMarkup(
			<VerificationPopover
				details={{
					methods: [{ kind: "organization", label: "Ryu review" }],
					verifiedSince: "2026-08-26T00:00:00.000Z",
				}}
				label="Show organization verification details"
				title="Verified organization"
				variant="badge"
			/>
		);
		const shield = renderToStaticMarkup(
			<VerificationPopover
				details={{
					methods: [
						{ kind: "email", label: "Verified email" },
						{ kind: "domain", label: "Verified domain" },
					],
					verifiedSince: "2026-08-26T00:00:00.000Z",
				}}
				label="Show profile verification details"
				title="Verified profile"
				variant="shield"
			/>
		);

		expect(badge).toContain('type="button"');
		expect(badge).toContain("Show organization verification details");
		expect(shield).toContain('type="button"');
		expect(shield).toContain("Show profile verification details");
	});
});
