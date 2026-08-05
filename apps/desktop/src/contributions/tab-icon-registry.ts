// Path → Iconify/Hugeicons id registry for title-bar tab glyphs.
//
// When a tab has no per-entity GlyphValue, TabGlyph resolves a string icon id
// here (longest/most-specific match) and renders it via `<Icon>` — the same
// resolver companions / sidebar sections already use. Apps register via:
//   1. Manifest contributions (companions, sidebar_sections, sidebar_buttons) —
//      seeded automatically by `usePluginContributionTabIcons`.
//   2. Runtime `shell.registerTabIcon` (grant `shell:integrate`) for dynamic cases.
// Built-in seeds cover Core surfaces (spaces / pages / databases) so those tabs
// never fall back to a generic chat icon.

export interface TabIconRule {
	/** Iconify `prefix:name`, bare Hugeicons name, or image URL — same as `<Icon>`. */
	icon: string;
	/** Unique id so callers can dispose a specific registration. */
	id: string;
	/**
	 * Optional substring the path must also contain (e.g. `/doc/`, `/db/`,
	 * `/app/@ryu/canvas/`). Lets pages/databases/app-docs share the `/spaces`
	 * prefix while keeping distinct glyphs.
	 */
	pathIncludes?: string;
	/**
	 * Path prefix to match (`/spaces`, `/meetings`, `/plugin/com.ryu.x`, …).
	 * A path matches when it equals the prefix or is a child (`prefix/…`).
	 */
	pathPrefix: string;
	/** Tie-breaker when specificity is equal. Higher wins. Default 0. */
	priority?: number;
}

type Listener = () => void;

const rules = new Map<string, TabIconRule>();
const listeners = new Set<Listener>();

function notify(): void {
	for (const listener of listeners) {
		listener();
	}
}

/** Subscribe to registry changes (TabGlyph re-resolves on notify). */
export function subscribeTabIcons(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function normalizePrefix(prefix: string): string {
	const trimmed = prefix.trim();
	if (!trimmed.startsWith("/")) {
		return `/${trimmed}`;
	}
	// Drop trailing slash except for root, so `/spaces/` ≡ `/spaces`.
	if (trimmed.length > 1 && trimmed.endsWith("/")) {
		return trimmed.slice(0, -1);
	}
	return trimmed;
}

/** Register (or replace) a tab-icon rule. Returns a disposer. */
export function registerTabIcon(
	rule: Omit<TabIconRule, "id"> & { id?: string }
): () => void {
	const id =
		rule.id ??
		`tab-icon:${rule.pathPrefix}:${rule.pathIncludes ?? ""}:${rule.icon}:${Math.random().toString(36).slice(2, 8)}`;
	const next: TabIconRule = {
		id,
		pathPrefix: normalizePrefix(rule.pathPrefix),
		pathIncludes: rule.pathIncludes || undefined,
		icon: rule.icon,
		priority: rule.priority ?? 0,
	};
	rules.set(id, next);
	notify();
	return () => {
		if (rules.delete(id)) {
			notify();
		}
	};
}

/** Register many rules; returns a single disposer that clears them all. */
export function registerTabIcons(
	batch: Array<Omit<TabIconRule, "id"> & { id?: string }>
): () => void {
	const disposers = batch.map((rule) => registerTabIcon(rule));
	return () => {
		for (const dispose of disposers) {
			dispose();
		}
	};
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}/`);
}

function scoreRule(rule: TabIconRule, path: string): number | null {
	if (!pathMatchesPrefix(path, rule.pathPrefix)) {
		return null;
	}
	if (rule.pathIncludes && !path.includes(rule.pathIncludes)) {
		return null;
	}
	// Prefer longer prefixes, then longer includes, then explicit priority.
	return (
		rule.pathPrefix.length * 1000 +
		(rule.pathIncludes?.length ?? 0) * 10 +
		(rule.priority ?? 0)
	);
}

/**
 * Resolve the best registered icon id for a tab path, or `undefined` when
 * nothing matches (caller falls back to the built-in Hugeicons PATH_ICONS map).
 */
export function resolveTabIcon(path: string): string | undefined {
	const base = path.split("?")[0] ?? path;
	let best: { icon: string; score: number } | undefined;
	for (const rule of rules.values()) {
		const score = scoreRule(rule, base);
		if (score === null) {
			continue;
		}
		if (!best || score > best.score) {
			best = { icon: rule.icon, score };
		}
	}
	return best?.icon;
}

/**
 * Derive a tab-icon rule from a sidebar section `itemTarget` template.
 * Templates like `/spaces/{{item.space_id}}/app/@ryu/canvas/{{item.id}}`
 * become `{ pathPrefix: "/spaces", pathIncludes: "/app/@ryu/canvas" }`.
 *
 * Returns null when the row's IDENTITY lives in the query string
 * (`/chat?conversationId={{item.id}}`). Such a target's path is a shared shell
 * route the app does not own — every one of its rows opens `/chat`, and `openTab`
 * stores tabs under the bare path — so a rule built from it would repaint EVERY
 * chat tab in the app with that section's glyph, not just the ones it opened.
 */
export function ruleFromItemTarget(
	itemTarget: string,
	icon: string,
	id: string
): (Omit<TabIconRule, "id"> & { id: string }) | null {
	const [rawPath, query] = itemTarget.split("?");
	if (query?.includes("{{")) {
		return null;
	}
	const template = rawPath?.trim();
	if (!template?.startsWith("/")) {
		return null;
	}
	const parts = template.split("/").filter(Boolean);
	let firstDynamic = -1;
	for (let i = 0; i < parts.length; i++) {
		if (parts[i]?.includes("{{")) {
			firstDynamic = i;
			break;
		}
	}
	// Segments before the first `{{…}}` form the path prefix (e.g. `/spaces`).
	const staticPrefix = firstDynamic < 0 ? parts : parts.slice(0, firstDynamic);
	const pathPrefix =
		staticPrefix.length > 0 ? `/${staticPrefix.join("/")}` : "/";
	// Remaining static segments (between/after dynamics) become pathIncludes
	// (e.g. `/app/@ryu/canvas` for canvas docs under a space).
	const trailingStatic = parts
		.slice(Math.max(firstDynamic, 0))
		.filter((p) => !p.includes("{{"));
	const pathIncludes =
		trailingStatic.length > 0 ? `/${trailingStatic.join("/")}` : undefined;
	// Avoid registering a bare "/" catch-all from a malformed template.
	if (pathPrefix === "/" && !pathIncludes) {
		return null;
	}
	return {
		id,
		pathPrefix,
		pathIncludes,
		icon,
		priority: pathIncludes ? 20 : 10,
	};
}

/** Built-in Core surface defaults — registered once at module load. */
registerTabIcons([
	{
		id: "builtin:spaces",
		pathPrefix: "/spaces",
		icon: "delivery-secure-01",
		priority: 0,
	},
	{
		id: "builtin:space-page",
		pathPrefix: "/spaces",
		pathIncludes: "/doc/",
		icon: "file-01",
		priority: 10,
	},
	{
		id: "builtin:space-database",
		pathPrefix: "/spaces",
		pathIncludes: "/db/",
		icon: "database",
		priority: 10,
	},
	{
		id: "builtin:meetings",
		pathPrefix: "/meetings",
		icon: "mic-01",
		priority: 0,
	},
]);
