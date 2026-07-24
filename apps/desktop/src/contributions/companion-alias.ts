// Resolving a legacy short path (`/calendar`, `/timeline`, `/inbox`, …) to the app
// that should answer it — the data-driven replacement for the twelve hardcoded
// `companionId: "app__<x>-companion"` aliases `builtins.ts` used to carry.
//
// Those aliases duplicated the `/plugin/<id>` seam `usePluginContributionRoutes`
// already mints per enabled companion, and — being frozen strings in shell code —
// kept resolving after their app was disabled, mounting a companion frame for
// something Core no longer serves. Everything here reads the LIVE contributions
// feed instead, so "the app is gone" and "the path resolves to nothing" are the
// same fact.
//
// Kept in its own module (like `registry.ts`, and unlike the rest of `builtins.ts`)
// because it is pure input → output: no React, no page imports, so `builtins.test.ts`
// can assert it without dragging the whole desktop page graph into the test runner.

import type { PluginContributions } from "@/src/lib/api/plugins.ts";

// A path segment is only ever compared after this normalisation, so casing or
// punctuation in a runnable id can never decide whether a legacy link resolves.
// Deliberately NOT applied to a companion's `label`/`name`: those are DISPLAY
// strings (translated, renamed for copy reasons), and a route that silently dies
// when someone retitles a button is worse than an explicit alias. A short path an
// app cannot derive from its id is spelled out at the call site instead.
const NON_SLUG_CHARS = /[^a-z0-9]+/g;
const EDGE_DASHES = /^-+|-+$/g;

/** Lowercase an identifier into one URL-safe path segment. */
function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(NON_SLUG_CHARS, "-")
		.replace(EDGE_DASHES, "");
}

/** The segment a companion id implies: `app__calendar-companion` → `calendar`. The
 *  `app__` prefix is Core's runnable namespace and `-companion` is the runnable-kind
 *  suffix every companion carries, so what remains is the app's own short name. */
function companionIdSlug(companionId: string): string {
	const withoutPrefix = companionId.startsWith("app__")
		? companionId.slice("app__".length)
		: companionId;
	const withoutSuffix = withoutPrefix.endsWith("-companion")
		? withoutPrefix.slice(0, -"-companion".length)
		: withoutPrefix;
	return slugify(withoutSuffix);
}

/** The slice of the contributions feed an alias lookup reads. Narrowed to exactly
 *  what it needs so a caller can hand over a literal in tests. */
export type CompanionAliasFeed = Pick<
	PluginContributions,
	"companions" | "sidebar_buttons"
>;

/**
 * Resolve a legacy short path to the companion id it should mount, purely from the
 * contributions feed.
 *
 * Lookup order, strongest declaration first:
 *   1. **Manifest-declared** — an enabled app's `sidebar_buttons[].target` equal to
 *      the path. The app itself asked to live there, so it wins; this is the tier a
 *      third-party app uses and the only one that may claim a multi-segment path.
 *   2. **Companion id** — `app__<slug>-companion` answers to `/<slug>`. Covers every
 *      built-in short path whose name matches its app (`/calendar`, `/timeline`, …).
 *
 * There is deliberately no third "match the display name" tier: a path that resolves
 * off a translatable label breaks the moment someone retitles a button. The two
 * legacy paths no app can derive from its id (`/inbox` → the approvals app,
 * `/skills/new` → the skill editor) are spelled out where they are registered, and
 * still name a PATH rather than a companion id so they blank out when disabled.
 *
 * Returns `null` when nothing matches — including when the owning app is disabled,
 * because a disabled app contributes no companion at all. That null is the point:
 * the route then renders blank instead of a stale companion frame.
 */
export function resolveCompanionAlias(
	feed: CompanionAliasFeed,
	alias: string
): string | null {
	const { companions, sidebar_buttons: buttons } = feed;
	const declared = buttons.find((b) => b.target === alias);
	if (declared) {
		const owned = companions.find((c) => c.pluginId === declared.plugin);
		if (owned) {
			return owned.id;
		}
	}
	// Tier 2 is a single-segment convention; a deeper path can only ever be claimed
	// explicitly (tier 1), never guessed.
	const segment = alias.startsWith("/") ? alias.slice(1) : alias;
	if (segment.length === 0 || segment.includes("/")) {
		return null;
	}
	return companions.find((c) => companionIdSlug(c.id) === segment)?.id ?? null;
}

/** The alias a deep link belongs to: `/timeline/1234` → `/timeline`. Lets the
 *  context-carrying routes find their app from their OWN path, so no route has to
 *  name one. */
export function topLevelAlias(path: string): string {
	return `/${path.split("/")[1]}`;
}
