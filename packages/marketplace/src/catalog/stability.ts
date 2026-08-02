// packages/marketplace/src/catalog/stability.ts
//
// How finished a listing is — "alpha", "beta", "rc", … — as the store renders it.
//
// Shared because the card and the detail header both show it, and a listing that
// reads "Beta" in one place and "beta" in the other looks like a bug.

/** Display label for a stability level.
 *
 *  Known levels get a proper label; anything else is title-cased and shown
 *  verbatim. That fallback is the point: the level is a free-form string in the
 *  published index precisely so a new tier can ship without a client release, and
 *  dropping an unrecognised value would defeat that. Same tolerance the surface
 *  labels settled on. */
const KNOWN: Record<string, string> = {
	alpha: "Alpha",
	beta: "Beta",
	canary: "Canary",
	experimental: "Experimental",
	nightly: "Nightly",
	prerelease: "Pre-release",
	rc: "Release candidate",
};

/** `null` when the listing is finished — absent, empty, or explicitly stable.
 *  Callers render nothing for `null`, so a stable listing never sprouts a badge. */
export function stabilityLabel(
	stability: string | null | undefined
): string | null {
	const raw = stability?.trim().toLowerCase();
	if (!raw || raw === "stable") {
		return null;
	}
	return KNOWN[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}
