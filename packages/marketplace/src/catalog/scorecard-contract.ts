// Shared scorecard contract and deterministic scoring fold.
//
// Rule modules only decide which checks apply to their listing type. This module
// owns the wire shape, category metadata, and the scoring semantics shared by
// every marketplace scorecard.

export type CheckStatus = "pass" | "warn" | "fail" | "unknown";

export type ScorecardCategory =
	| "hygiene"
	| "maintenance"
	| "review"
	| "disclosures"
	| "errors";

export interface ScorecardCheck {
	category: ScorecardCategory;
	/** Human sentence explaining the verdict — always populated, including for
	 *  `pass`, so the tab reads as a report rather than a row of ticks. */
	detail: string;
	id: string;
	label: string;
	status: CheckStatus;
	/** Relative importance within the total score. */
	weight: number;
}

export interface CategoryScore {
	category: ScorecardCategory;
	fail: number;
	pass: number;
	/** 0–100 within this category, or null when every check was `unknown`. */
	score: number | null;
	unknown: number;
	warn: number;
}

export type ScorecardGrade = "A" | "B" | "C" | "D" | "F";
export type ScorecardRulesetVersion =
	| "marketplace-plugin-1"
	| "marketplace-skill-1";

export interface Scorecard {
	categories: CategoryScore[];
	checks: ScorecardCheck[];
	/** How many checks actually counted toward the score. */
	evaluated: number;
	grade: ScorecardGrade | null;
	/** Stable wire metadata so CI and UI can identify the grading rules. */
	rulesetVersion: ScorecardRulesetVersion;
	schemaVersion: "1";
	/** 0–100 over the evaluated checks, or null when nothing was checkable. */
	score: number | null;
	/** One-line verdict for the header badge. */
	summary: string;
}

const CATEGORY_ORDER: ScorecardCategory[] = [
	"review",
	"disclosures",
	"maintenance",
	"hygiene",
	"errors",
];

export const CATEGORY_LABELS: Record<ScorecardCategory, string> = {
	disclosures: "Disclosures",
	errors: "Errors",
	hygiene: "Hygiene",
	maintenance: "Maintenance",
	review: "Review & provenance",
};

export const CATEGORY_DESCRIPTIONS: Record<ScorecardCategory, string> = {
	disclosures: "What it tells you about the data and access it wants.",
	errors: "Problems found while reading the listing itself.",
	hygiene: "Whether the listing is complete and correctly described.",
	maintenance: "Whether anyone is still looking after it.",
	review: "Who published it and who checked it.",
};

const STATUS_POINTS: Record<CheckStatus, number> = {
	fail: 0,
	pass: 1,
	unknown: 0,
	warn: 0.5,
};

/** Weighted points a check contributes. `unknown` never reaches here — it is
 * filtered out of both the numerator and the denominator. */
function points(check_: ScorecardCheck): number {
	return check_.weight * STATUS_POINTS[check_.status];
}

/** Whole days since an ISO timestamp, or null when it is absent/unparseable.
 * `now` is injected so the checks are deterministic under test. */
export function daysSince(
	iso: string | null | undefined,
	now: number
): number | null {
	if (!iso) {
		return null;
	}
	const parsed = Date.parse(iso);
	if (Number.isNaN(parsed)) {
		return null;
	}
	return Math.floor((now - parsed) / (24 * 60 * 60 * 1000));
}

/** Format a day count the way the detail rows read best. */
export function agoLabel(days: number): string {
	if (days <= 0) {
		return "today";
	}
	if (days === 1) {
		return "yesterday";
	}
	if (days < 60) {
		return `${days} days ago`;
	}
	if (days < 365) {
		return `${Math.round(days / 30)} months ago`;
	}
	const years = (days / 365).toFixed(1).replace(/\.0$/, "");
	return `${years} years ago`;
}

export function check(
	id: string,
	category: ScorecardCategory,
	label: string,
	weight: number,
	status: CheckStatus,
	detail: string
): ScorecardCheck {
	return { category, detail, id, label, status, weight };
}

/** Roll a check list up into per-category scores, preserving display order. */
function summarizeCategories(checks: ScorecardCheck[]): CategoryScore[] {
	return CATEGORY_ORDER.filter((category) =>
		checks.some((c) => c.category === category)
	).map((category) => {
		const inCategory = checks.filter((c) => c.category === category);
		const scored = inCategory.filter((c) => c.status !== "unknown");
		const earned = scored.reduce((sum, c) => sum + points(c), 0);
		const possible = scored.reduce((sum, c) => sum + c.weight, 0);
		return {
			category,
			fail: inCategory.filter((c) => c.status === "fail").length,
			pass: inCategory.filter((c) => c.status === "pass").length,
			score: possible > 0 ? Math.round((earned / possible) * 100) : null,
			unknown: inCategory.filter((c) => c.status === "unknown").length,
			warn: inCategory.filter((c) => c.status === "warn").length,
		};
	});
}

function gradeFor(score: number): ScorecardGrade {
	if (score >= 90) {
		return "A";
	}
	if (score >= 75) {
		return "B";
	}
	if (score >= 60) {
		return "C";
	}
	if (score >= 40) {
		return "D";
	}
	return "F";
}

function summaryFor(
	score: number | null,
	failures: number,
	warnings: number
): string {
	if (score === null) {
		return "Not enough information to assess this listing.";
	}
	if (failures > 0) {
		return `${failures} failed check${failures === 1 ? "" : "s"} — read them before installing.`;
	}
	if (warnings > 0) {
		return `Passes every critical check, with ${warnings} thing${warnings === 1 ? "" : "s"} worth knowing.`;
	}
	return "Passes every automated check.";
}

export function buildScorecard(
	checks: ScorecardCheck[],
	rulesetVersion: ScorecardRulesetVersion
): Scorecard {
	const scored = checks.filter((c) => c.status !== "unknown");
	const earned = scored.reduce((sum, c) => sum + points(c), 0);
	const possible = scored.reduce((sum, c) => sum + c.weight, 0);
	const score = possible > 0 ? Math.round((earned / possible) * 100) : null;

	return {
		categories: summarizeCategories(checks),
		checks,
		evaluated: scored.length,
		grade: score === null ? null : gradeFor(score),
		rulesetVersion,
		schemaVersion: "1",
		score,
		summary: summaryFor(
			score,
			checks.filter((c) => c.status === "fail").length,
			checks.filter((c) => c.status === "warn").length
		),
	};
}
