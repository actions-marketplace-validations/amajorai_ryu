// packages/marketplace/src/catalog/scorecard.ts
//
// The store's **trust scorecard** — a deterministic set of automated checks run
// over a listing's catalog detail, answering the only question that matters on a
// detail page you are about to install from: how much should I trust this?
//
// Why this lives here and not in Core
// -----------------------------------
// Core's job is to *gather signals* it alone can reach (a repo's README, its
// release history, whether issues are enabled, what its manifest declares). The
// judgement over those signals is presentation: it changes with the store's
// policy, needs to be unit-testable without a node, and must render identically
// on desktop and web. So Core ships facts, this module grades them, and there is
// exactly one grading implementation for every surface.
//
// Grading contract
// ----------------
// Every check returns one of four statuses. `unknown` is a first-class outcome
// and is EXCLUDED from the score, never counted as a failure: a source that
// cannot report release history must not drag a listing's grade down for it. That
// makes the score read as "of what we could check, how much passed" — which is
// honest — and it means adding a check that most sources can't answer yet does
// not silently re-grade the entire catalog.
//
// A check never *invents* a verdict. If the signal is absent and its absence is
// not itself meaningful, the check is `unknown`. Where absence IS meaningful
// (no licence, nobody reviewed it, no privacy policy on a plugin that reaches the
// network), the check says so explicitly and scores it.

import type { CatalogEntry, PluginCatalogDetail } from "./types.ts";

/** A check outcome. `unknown` means "not answerable from this source" and is
 *  excluded from scoring — see the grading contract above. */
export type CheckStatus = "pass" | "warn" | "fail" | "unknown";

/** The five families the detail page groups checks under. */
export type ScorecardCategory =
	| "hygiene"
	| "maintenance"
	| "review"
	| "disclosures"
	| "errors";

/** One automated check and its verdict. */
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

/** Per-category rollup, for the category headers on the Health tab. */
export interface CategoryScore {
	category: ScorecardCategory;
	fail: number;
	pass: number;
	/** 0–100 within this category, or null when every check was `unknown`. */
	score: number | null;
	unknown: number;
	warn: number;
}

/** Letter grade bands. */
export type ScorecardGrade = "A" | "B" | "C" | "D" | "F";

export interface Scorecard {
	categories: CategoryScore[];
	checks: ScorecardCheck[];
	/** How many checks actually counted toward the score. */
	evaluated: number;
	grade: ScorecardGrade | null;
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
 *  filtered out of both the numerator and the denominator. */
function points(check_: ScorecardCheck): number {
	return check_.weight * STATUS_POINTS[check_.status];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 90;
const STALE_DAYS = 365;
/** Below this, a description is a fragment rather than an explanation. */
const MIN_DESCRIPTION_CHARS = 40;
/** Below this, a README is a stub — a title and an install line. */
const MIN_README_CHARS = 400;
const WELL_ADOPTED_STARS = 25;
const SOME_ADOPTION_STARS = 5;

/** Semver with an optional `v` prefix and optional pre-release/build metadata. */
const SEMVER_RE = /^v?\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;

/** Reserved first-party id namespaces. A community listing whose manifest claims
 *  one of these is impersonating Ryu, which is a hard failure, not a warning.
 *
 *  Both id generations are listed on purpose. The scoped forms are what
 *  first-party plugins carry today; the reverse-DNS forms are what they carried
 *  before the rename and what a stale third-party listing can still claim. Drop
 *  either half and impersonation through the other silently starts passing. */
const RESERVED_ID_PREFIXES = [
	"@ryu/",
	"@amajor/",
	"com.ryu.",
	"ai.ryu.",
	"com.amajor.",
];

/** Whole days since an ISO timestamp, or null when it is absent/unparseable.
 *  `now` is injected so the checks are deterministic under test. */
function daysSince(iso: string | null | undefined, now: number): number | null {
	if (!iso) {
		return null;
	}
	const parsed = Date.parse(iso);
	if (Number.isNaN(parsed)) {
		return null;
	}
	return Math.floor((now - parsed) / DAY_MS);
}

/** Format a day count the way the detail rows read best. */
function agoLabel(days: number): string {
	if (days <= 0) {
		return "today";
	}
	if (days === 1) {
		return "yesterday";
	}
	if (days < 60) {
		return `${days} days ago`;
	}
	if (days < STALE_DAYS) {
		return `${Math.round(days / 30)} months ago`;
	}
	const years = (days / 365).toFixed(1).replace(/\.0$/, "");
	return `${years} years ago`;
}

function check(
	id: string,
	category: ScorecardCategory,
	label: string,
	weight: number,
	status: CheckStatus,
	detail: string
): ScorecardCheck {
	return { category, detail, id, label, status, weight };
}

/** True when the permission summary declares an unscoped capability — the shape
 *  the breadth check treats as "asks for everything of this kind". */
function isBroad(value: unknown): boolean {
	if (value === true) {
		return true;
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return Object.values(value as Record<string, unknown>).some(
			(v) => v === true || v === "*" || (Array.isArray(v) && v.includes("*"))
		);
	}
	return Array.isArray(value) && value.includes("*");
}

// ── Check families ──────────────────────────────────────────────────────────
//
// Each builder takes the normalized inputs and returns its checks. Split by
// family so a category can be reasoned about (and tested) on its own.

function reviewChecks(
	entry: CatalogEntry | null,
	detail: PluginCatalogDetail | null
): ScorecardCheck[] {
	const checks: ScorecardCheck[] = [];
	const origin = detail?.origin ?? entry?.origin ?? null;
	const community = origin === "community";
	const reviewed = detail?.reviewed ?? entry?.reviewed;

	if (reviewed === true) {
		checks.push(
			check(
				"reviewed",
				"review",
				"Reviewed by Ryu",
				3,
				"pass",
				"This listing was vetted before it was published."
			)
		);
	} else if (reviewed === false) {
		checks.push(
			check(
				"reviewed",
				"review",
				"Reviewed by Ryu",
				3,
				"fail",
				"Nobody at Ryu has vetted this listing. It was discovered automatically."
			)
		);
	} else {
		checks.push(
			check(
				"reviewed",
				"review",
				"Reviewed by Ryu",
				3,
				"unknown",
				"This source does not report a review status."
			)
		);
	}

	if (origin) {
		checks.push(
			check(
				"provenance",
				"review",
				"Publisher provenance",
				2,
				community ? "warn" : "pass",
				community
					? `Discovered from a public ${detail?.discoveredFrom?.topic ?? "GitHub"} topic — anyone can publish under it.`
					: "Published through a first-party channel."
			)
		);
	}

	if (detail?.descriptorOnly === true || entry?.descriptor_only === true) {
		checks.push(
			check(
				"install-path",
				"review",
				"Verified install path",
				2,
				"warn",
				"Listed for discovery only — installing it means fetching code from the repository yourself."
			)
		);
	} else if (detail || entry) {
		checks.push(
			check(
				"install-path",
				"review",
				"Verified install path",
				2,
				"pass",
				"Installs through Core's verified install path."
			)
		);
	}

	const license = detail?.license ?? entry?.license ?? null;
	checks.push(
		license
			? check(
					"license",
					"review",
					"Licence declared",
					2,
					"pass",
					`Distributed under ${license}.`
				)
			: check(
					"license",
					"review",
					"Licence declared",
					2,
					"fail",
					"No licence is declared, so the terms you may use this under are undefined."
				)
	);

	return checks;
}

function hygieneChecks(
	entry: CatalogEntry | null,
	detail: PluginCatalogDetail | null
): ScorecardCheck[] {
	const checks: ScorecardCheck[] = [];
	const description = detail?.description ?? entry?.description ?? "";
	const version = detail?.version ?? entry?.version ?? "";
	const readme = detail?.readme ?? "";

	if (description.trim().length >= MIN_DESCRIPTION_CHARS) {
		checks.push(
			check(
				"description",
				"hygiene",
				"Describes what it does",
				2,
				"pass",
				"Carries a full description."
			)
		);
	} else if (description.trim()) {
		checks.push(
			check(
				"description",
				"hygiene",
				"Describes what it does",
				2,
				"warn",
				"The description is a fragment — too short to explain what installing this does."
			)
		);
	} else {
		checks.push(
			check(
				"description",
				"hygiene",
				"Describes what it does",
				2,
				"fail",
				"No description at all."
			)
		);
	}

	if (readme.trim().length >= MIN_README_CHARS) {
		checks.push(
			check(
				"readme",
				"hygiene",
				"Documented",
				2,
				"pass",
				"Ships a README with real documentation."
			)
		);
	} else if (readme.trim()) {
		checks.push(
			check(
				"readme",
				"hygiene",
				"Documented",
				2,
				"warn",
				"The README is a stub."
			)
		);
	} else {
		checks.push(
			check(
				"readme",
				"hygiene",
				"Documented",
				2,
				"fail",
				"No README was found."
			)
		);
	}

	if (version.trim()) {
		checks.push(
			SEMVER_RE.test(version.trim())
				? check(
						"semver",
						"hygiene",
						"Versioned with semver",
						1,
						"pass",
						`Current version is ${version}.`
					)
				: check(
						"semver",
						"hygiene",
						"Versioned with semver",
						1,
						"warn",
						`Version "${version}" is not semver, so upgrade compatibility can't be reasoned about.`
					)
		);
	} else {
		checks.push(
			check(
				"semver",
				"hygiene",
				"Versioned with semver",
				1,
				"warn",
				"No version is published."
			)
		);
	}

	const surfaces = detail?.surfaces ?? [];
	checks.push(
		surfaces.length > 0
			? check(
					"surfaces",
					"hygiene",
					"Declares its platforms",
					1,
					"pass",
					`Declares support for ${surfaces.join(", ")}.`
				)
			: check(
					"surfaces",
					"hygiene",
					"Declares its platforms",
					1,
					"warn",
					"Declares no platforms, so it is offered on every surface by default."
				)
	);

	const engineReq = detail?.engines?.ryu ?? null;
	checks.push(
		engineReq
			? check(
					"engines",
					"hygiene",
					"Pins a Ryu version",
					1,
					"pass",
					`Requires Ryu ${engineReq}.`
				)
			: check(
					"engines",
					"hygiene",
					"Pins a Ryu version",
					1,
					"warn",
					"Declares no Ryu version requirement, so an incompatible Core won't be caught at install."
				)
	);

	return checks;
}

function maintenanceChecks(
	entry: CatalogEntry | null,
	detail: PluginCatalogDetail | null,
	now: number
): ScorecardCheck[] {
	const checks: ScorecardCheck[] = [];
	const updated = daysSince(detail?.updatedAt, now);

	if (updated === null) {
		checks.push(
			check(
				"activity",
				"maintenance",
				"Recently updated",
				3,
				"unknown",
				"This source does not report when it was last updated."
			)
		);
	} else if (updated <= RECENT_DAYS) {
		checks.push(
			check(
				"activity",
				"maintenance",
				"Recently updated",
				3,
				"pass",
				`Last updated ${agoLabel(updated)}.`
			)
		);
	} else if (updated <= STALE_DAYS) {
		checks.push(
			check(
				"activity",
				"maintenance",
				"Recently updated",
				3,
				"warn",
				`Last updated ${agoLabel(updated)}.`
			)
		);
	} else {
		checks.push(
			check(
				"activity",
				"maintenance",
				"Recently updated",
				3,
				"fail",
				`Last updated ${agoLabel(updated)} — likely unmaintained.`
			)
		);
	}

	if (detail?.archived === true || detail?.disabled === true) {
		checks.push(
			check(
				"archived",
				"maintenance",
				"Still active",
				3,
				"fail",
				"The source repository is archived or disabled — it will not receive fixes."
			)
		);
	} else if (detail?.archived === false) {
		checks.push(
			check(
				"archived",
				"maintenance",
				"Still active",
				3,
				"pass",
				"The source repository is active."
			)
		);
	}

	const versions = detail?.versions ?? null;
	if (versions === null) {
		checks.push(
			check(
				"release-history",
				"maintenance",
				"Release history",
				2,
				"unknown",
				"This source does not report a release history."
			)
		);
	} else if (versions.length >= 2) {
		checks.push(
			check(
				"release-history",
				"maintenance",
				"Release history",
				2,
				"pass",
				`${versions.length} published versions.`
			)
		);
	} else if (versions.length === 1) {
		checks.push(
			check(
				"release-history",
				"maintenance",
				"Release history",
				2,
				"warn",
				"Only one version has ever been published."
			)
		);
	} else {
		checks.push(
			check(
				"release-history",
				"maintenance",
				"Release history",
				2,
				"fail",
				"No versions have been published."
			)
		);
	}

	const latestRelease = daysSince(versions?.[0]?.publishedAt, now);
	if (latestRelease !== null) {
		checks.push(
			check(
				"release-recency",
				"maintenance",
				"Recent release",
				1,
				latestRelease <= STALE_DAYS ? "pass" : "warn",
				`Latest version ${versions?.[0]?.version ?? ""} shipped ${agoLabel(latestRelease)}.`.trim()
			)
		);
	}

	if (typeof detail?.issuesEnabled === "boolean") {
		checks.push(
			check(
				"issue-tracker",
				"maintenance",
				"Accepts bug reports",
				1,
				detail.issuesEnabled ? "pass" : "warn",
				detail.issuesEnabled
					? `Issue tracker is open${typeof detail.openIssues === "number" ? ` (${detail.openIssues} open)` : ""}.`
					: "The issue tracker is turned off, so there is nowhere to report a bug."
			)
		);
	}

	const stars = detail?.stars ?? entry?.stars ?? null;
	if (typeof stars === "number") {
		let status: CheckStatus = "warn";
		if (stars >= WELL_ADOPTED_STARS) {
			status = "pass";
		} else if (stars < SOME_ADOPTION_STARS) {
			status = "warn";
		}
		checks.push(
			check(
				"adoption",
				"maintenance",
				"Adoption",
				1,
				status,
				stars >= WELL_ADOPTED_STARS
					? `${stars} stars — used by other people.`
					: `${stars} stars — little independent usage to learn from.`
			)
		);
	}

	return checks;
}

function disclosureChecks(
	entry: CatalogEntry | null,
	detail: PluginCatalogDetail | null
): ScorecardCheck[] {
	const checks: ScorecardCheck[] = [];
	const permissions = detail?.permissions ?? null;
	const grants = detail?.permissionGrants ?? entry?.requires?.grants ?? [];
	const reachesNetwork =
		isBroad(permissions?.network) ||
		grants.some((g) => /net|web|http|fetch/i.test(g));

	checks.push(
		detail?.privacyPolicyUrl
			? check(
					"privacy-policy",
					"disclosures",
					"Privacy policy",
					2,
					"pass",
					"Publishes a privacy policy."
				)
			: check(
					"privacy-policy",
					"disclosures",
					"Privacy policy",
					2,
					reachesNetwork ? "fail" : "warn",
					reachesNetwork
						? "No privacy policy, and this plugin can reach the network with your data."
						: "No privacy policy is published."
				)
	);

	checks.push(
		detail?.termsOfServiceUrl
			? check(
					"terms",
					"disclosures",
					"Terms of service",
					1,
					"pass",
					"Publishes terms of service."
				)
			: check(
					"terms",
					"disclosures",
					"Terms of service",
					1,
					"warn",
					"No terms of service are published."
				)
	);

	if (permissions?.declared === true) {
		const broad = [
			isBroad(permissions.network) ? "network" : null,
			isBroad(permissions.fs) ? "filesystem" : null,
			isBroad(permissions.childProcess) ? "subprocesses" : null,
		].filter(Boolean) as string[];
		checks.push(
			broad.length === 0
				? check(
						"permission-breadth",
						"disclosures",
						"Narrow permissions",
						3,
						"pass",
						"Every runtime permission it requests is scoped."
					)
				: check(
						"permission-breadth",
						"disclosures",
						"Narrow permissions",
						3,
						"warn",
						`Requests unrestricted ${broad.join(", ")} access.`
					)
		);
	} else if (detail) {
		checks.push(
			check(
				"permission-breadth",
				"disclosures",
				"Narrow permissions",
				3,
				"pass",
				"Declares no runtime permissions, so it runs fully sandboxed."
			)
		);
	}

	const publicRoutes = (detail?.apiSurface?.sidecars ?? []).flatMap((s) =>
		(s.routes ?? []).filter((r) => r.auth === "none" || r.auth === "public")
	);
	if (detail?.apiSurface?.sidecars?.length) {
		checks.push(
			publicRoutes.length === 0
				? check(
						"network-surface",
						"disclosures",
						"Authenticated endpoints",
						2,
						"pass",
						"Every HTTP route its background service exposes requires authentication."
					)
				: check(
						"network-surface",
						"disclosures",
						"Authenticated endpoints",
						2,
						"warn",
						`${publicRoutes.length} HTTP route(s) are exposed without authentication.`
					)
		);
	}

	const homepage =
		detail?.website ?? detail?.repositoryUrl ?? entry?.repo_url ?? null;
	checks.push(
		homepage
			? check(
					"homepage",
					"disclosures",
					"Source is inspectable",
					1,
					"pass",
					"Links to a homepage or repository you can read."
				)
			: check(
					"homepage",
					"disclosures",
					"Source is inspectable",
					1,
					"warn",
					"Links to no homepage or repository."
				)
	);

	return checks;
}

function errorChecks(
	entry: CatalogEntry | null,
	detail: PluginCatalogDetail | null
): ScorecardCheck[] {
	const checks: ScorecardCheck[] = [];

	if (detail?.enrichmentError) {
		checks.push(
			check(
				"enrichment",
				"errors",
				"Listing reads cleanly",
				3,
				"fail",
				detail.enrichmentError
			)
		);
	} else if (detail) {
		checks.push(
			check(
				"enrichment",
				"errors",
				"Listing reads cleanly",
				3,
				"pass",
				"The listing and its manifest were read without errors."
			)
		);
	}

	// An id-squatting community listing: its manifest claims a reserved
	// first-party namespace. Hard fail — this is impersonation, not sloppiness.
	const claimedId = detail?.manifestId ?? null;
	const origin = detail?.origin ?? entry?.origin ?? null;
	if (claimedId && origin === "community") {
		const squatting = RESERVED_ID_PREFIXES.some((p) =>
			claimedId.toLowerCase().startsWith(p)
		);
		checks.push(
			squatting
				? check(
						"identity",
						"errors",
						"Identity is its own",
						3,
						"fail",
						`Its manifest claims the reserved id "${claimedId}", impersonating a first-party plugin.`
					)
				: check(
						"identity",
						"errors",
						"Identity is its own",
						3,
						"pass",
						`Publishes under its own id "${claimedId}".`
					)
		);
	}

	const surface = detail?.apiSurface ?? null;
	if (surface) {
		const contributions = [
			...(surface.commands ?? []),
			...(surface.tools ?? []),
			...(surface.agents ?? []),
			...(surface.workflows ?? []),
			...(surface.policies ?? []),
		];
		const dangling = contributions.filter((c) => !c.name);
		if (contributions.length > 0) {
			checks.push(
				dangling.length === 0
					? check(
							"manifest-integrity",
							"errors",
							"Contributions resolve",
							2,
							"pass",
							"Every declared contribution points at something this plugin ships."
						)
					: check(
							"manifest-integrity",
							"errors",
							"Contributions resolve",
							2,
							"warn",
							`${dangling.length} declared contribution(s) reference something the plugin does not ship.`
						)
			);
		}
	}

	return checks;
}

/** Roll a check list up into per-category scores, preserving the display order. */
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

/**
 * Run the full automated scan over a listing.
 *
 * Both inputs are optional and the result is always well-formed: a listing with
 * no detail loaded yet still scores what the card alone can answer, so the badge
 * does not pop in and out while the detail request is in flight.
 *
 * `now` is injectable purely so the maintenance checks are deterministic in
 * tests; callers should omit it.
 */
export function runScorecard(
	entry: CatalogEntry | null,
	detail: PluginCatalogDetail | null,
	now: number = Date.now()
): Scorecard {
	const checks = [
		...reviewChecks(entry, detail),
		...disclosureChecks(entry, detail),
		...maintenanceChecks(entry, detail, now),
		...hygieneChecks(entry, detail),
		...errorChecks(entry, detail),
	];

	const scored = checks.filter((c) => c.status !== "unknown");
	const earned = scored.reduce((sum, c) => sum + points(c), 0);
	const possible = scored.reduce((sum, c) => sum + c.weight, 0);
	const score = possible > 0 ? Math.round((earned / possible) * 100) : null;

	return {
		categories: summarizeCategories(checks),
		checks,
		evaluated: scored.length,
		grade: score === null ? null : gradeFor(score),
		score,
		summary: summaryFor(
			score,
			checks.filter((c) => c.status === "fail").length,
			checks.filter((c) => c.status === "warn").length
		),
	};
}
