// Reader for Core's plugin CONTRIBUTIONS feed, projected to the one family the
// terminal renders: declarative `views`.
//
//   - data: GET /api/plugins/contributions -> json.views (each entry tagged with its
//     owning `plugin` id by Core). The TUI set `X-Ryu-Surface: cli` at entry
//     (src/index.tsx), so Core has ALREADY filtered the feed to plugins that target
//     this surface — nothing here re-filters and nothing here knows an app id.
//
// The wire shape is snake_case-free (the Rust `ViewContribution` declares no
// renames), so the projection is mostly a type-narrowing pass: drop entries without
// a string `id`/`view`, keep `spec` opaque, remember the owning plugin. A malformed
// entry is skipped rather than thrown on — one bad manifest must not blank the feed.
//
// ── HOW A CONTRIBUTED VIEW REACHES A SCREEN ─────────────────────────────────
// Two routes, both data-driven:
//   1. Every contributed view is navigable at `/plugin-view/<plugin>/<viewId>`
//      ({@link pluginViewPath}) — the generic surface, mirroring the desktop's
//      `PluginViewPage` route mint. Nothing needs to know the app exists.
//   2. A view whose id is the reserved token `surface:<id>` CLAIMS the built-in
//      surface with that id ({@link viewClaimingSurface}): the shell renders the
//      contributed view at `/calendar` instead of its own hand-written screen. The
//      view id is the claim token — the "stable id, route/anchor key" the Rust
//      contract documents — so an app takes over a screen by declaring it, never by
//      the shell naming the app. Until an app claims it, the built-in keeps
//      rendering.
//
//      The `surface:` prefix is load-bearing, not decoration. A view id is only
//      unique PER PLUGIN, and the built-in surface ids are common words (tasks,
//      calendar, monitors…), so matching a bare id would let any third-party app
//      that happens to name a view `"tasks"` silently hijack the built-in Tasks
//      screen. The namespaced token has to be typed on purpose.

import { type ApiTarget, apiUrl, makeHeaders } from "@ryuhq/core-client/client";
import type { ViewSpec } from "./views.ts";
import { isKnownViewKind, validateView } from "./views.ts";

/** One plugin-contributed declarative view, tagged with its owning plugin id.
 *  Mirrors Core's `ViewContribution` plus the `plugin` field the contributions
 *  endpoint injects. `spec` is opaque to Core; the renderer interprets it. */
export interface ContributedView {
	id: string;
	/** Owning plugin id (e.g. `com.acme.tracker`). Empty when Core did not tag it. */
	plugin: string;
	spec?: ViewSpec;
	title?: string;
	/** The vocabulary member this view renders as. Kept as a plain string: Core
	 *  passes unknown kinds through, and the renderer degrades readably. */
	view: string;
}

/** Wire shape of one `views[]` entry of `GET /api/plugins/contributions`. */
interface ContributedViewWire {
	id?: unknown;
	plugin?: unknown;
	spec?: unknown;
	title?: unknown;
	view?: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null;

/** Narrow one wire entry, or null when it is unusable (no id / no kind). The
 *  `spec` is trusted structurally only as far as its own `view` discriminant: the
 *  renderer switches on that and falls back for anything it does not know. */
function toContributedView(wire: ContributedViewWire): ContributedView | null {
	if (typeof wire.id !== "string" || wire.id.length === 0) {
		return null;
	}
	const kind = typeof wire.view === "string" ? wire.view : undefined;
	const spec =
		isRecord(wire.spec) && isKnownViewKind(wire.spec.view)
			? (wire.spec as unknown as ViewSpec)
			: undefined;
	if (!(kind || spec)) {
		return null;
	}
	return {
		id: wire.id,
		plugin: typeof wire.plugin === "string" ? wire.plugin : "",
		title: typeof wire.title === "string" ? wire.title : undefined,
		view: kind ?? spec?.view ?? "",
		spec,
	};
}

/** Project a raw contributions payload to the views the terminal can render.
 *  Exported for the tests; {@link fetchContributedViews} is the normal entry. */
export function contributedViewsFromResponse(
	payload: unknown
): ContributedView[] {
	const raw = isRecord(payload) ? payload.views : undefined;
	if (!Array.isArray(raw)) {
		return [];
	}
	const out: ContributedView[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) {
			continue;
		}
		const view = toContributedView(entry as ContributedViewWire);
		if (view) {
			out.push(view);
		}
	}
	return out;
}

/** GET /api/plugins/contributions -> the enabled plugins' declarative views.
 *  Core-client has no typed reader for this endpoint, so it is fetched with the
 *  shared HTTP primitives (parity with the `/api/catalog` read in src/tabs/apps.tsx).
 *  Throws on a non-2xx so the caller can decide whether to surface it — the
 *  contributions context treats any failure as "no contributions". */
export async function fetchContributedViews(
	target: ApiTarget,
	signal?: AbortSignal
): Promise<ContributedView[]> {
	const resp = await fetch(apiUrl(target, "/api/plugins/contributions"), {
		headers: makeHeaders(target.token),
		signal,
	});
	if (!resp.ok) {
		throw new Error(`/api/plugins/contributions failed: ${resp.status}`);
	}
	return contributedViewsFromResponse(await resp.json());
}

/** The route a contributed view is navigable at. Both segments are encoded so an
 *  exotic id round-trips (mirrors the desktop `pluginViewPath`). */
export function pluginViewPath(pluginId: string, viewId: string): string {
	return `/plugin-view/${encodeURIComponent(pluginId)}/${encodeURIComponent(viewId)}`;
}

/** The `{plugin, view}` ids encoded in a `/plugin-view/...` path, or null when the
 *  path is not one (or is missing a segment). */
export function parsePluginViewPath(
	path: string
): { plugin: string; view: string } | null {
	const segments = path.split("/").filter((segment) => segment.length > 0);
	if (segments[0] !== "plugin-view" || segments.length < 3) {
		return null;
	}
	return {
		plugin: decodeURIComponent(segments[1] ?? ""),
		view: decodeURIComponent(segments[2] ?? ""),
	};
}

/** The reserved view id an app declares to take over the built-in surface
 *  `surfaceId` — e.g. `surfaceClaimToken("calendar") === "surface:calendar"`. */
export function surfaceClaimToken(surfaceId: string): string {
	return `surface:${surfaceId}`;
}

/** The contributed view that CLAIMS a built-in surface, or undefined when none
 *  does — the seam that lets an app retire a hand-written screen. A view with
 *  `id: "surface:calendar"` takes over the surface registered as `calendar` (see
 *  the header for why the token is namespaced). Feed order breaks a tie between two
 *  claimants, which is the plugin load order Core serves.
 *
 *  A claim only counts when the spec actually DRAWS: it must be present (a
 *  title-only manifest entry must not blank a working screen) and structurally
 *  valid (`validateView` — a `list-detail` with no `items` renders the renderer's
 *  "unsupported view" line, and swapping a screen full of real data for that line
 *  is a worse outcome than simply not handing the screen over). Losing the claim
 *  leaves the built-in surface rendering exactly as it did before the app existed. */
export function viewClaimingSurface(
	views: readonly ContributedView[],
	surfaceId: string
): ContributedView | undefined {
	const token = surfaceClaimToken(surfaceId);
	return views.find((view) => view.id === token && validateView(view.spec).ok);
}
