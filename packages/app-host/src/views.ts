// The **declarative view vocabulary** — the Raycast tier landed on Ryu's existing
// contribution registry.
//
// A companion app never renders. It returns a **view spec**: a plain-DATA description
// (`items`/`columns`/`actions`/`fields`) tagged by a `view` kind. The host shell maps
// that spec to its OWN native components — real `@ryu/ui` on the desktop, the compact
// command-bar idiom on the island — so one spec renders natively on every surface and
// cannot be made ugly (no bundle, no theme bridge, no "ugly-finetune" class of bug).
//
// This module is the single source of truth for the vocabulary, shared by every
// per-surface renderer. It is pure TS (types + tiny pure helpers), so the island can
// consume it as an `import type` with zero runtime coupling. The Rust envelope lives
// in `ryu-kernel-contracts` (`Contributes::views` / `ViewContribution`); the `view` +
// `spec` there are opaque, so a new kind added here needs no Core change.

/** The seven standardized view kinds — the patterns repeated across every CRUD
 *  companion page today, exposed once and host-rendered. */
export const VIEW_KINDS = [
	"list-detail",
	"data-table",
	"form",
	"action-panel",
	"filter-bar",
	"empty-state",
	"stat-card-row",
] as const;

export type ViewKind = (typeof VIEW_KINDS)[number];

/** Visual tone shared by badges and stats — mapped by each renderer to its own
 *  palette (a `@ryu/ui` Badge variant on desktop, a colored dot on the island). */
export type ViewTone = "neutral" | "success" | "warning" | "danger" | "info";

/** How prominent an action is. `primary` is the default/confirm affordance;
 *  `danger` is destructive; `default` is a plain secondary action. */
export type ViewActionStyle = "primary" | "default" | "danger";

/** HTTP methods a declarative action may use against the Core API. */
export const VIEW_ACTION_HTTP_METHODS = [
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
] as const;

export type ViewActionHttpMethod = (typeof VIEW_ACTION_HTTP_METHODS)[number];

/**
 * A **declarative HTTP handler** for a {@link ViewAction} — the CRUD tier that
 * makes actions work with NO per-app sidecar code. The shell executes the request
 * against the node's Core API through its own authenticated fetch seam (the spec
 * never sees a token). `path` and string leaves of `body` support `{{field}}`
 * templating from collected form values and `{{item.<key>}}` from the selected
 * list/table item (see {@link renderActionHttp}). Paths are Core-relative and
 * must start with `/api/` ({@link isCoreApiPath}) — a spec can never point the
 * host's credentials at an arbitrary URL.
 */
export interface ViewActionHttp {
	/** Optional JSON body template. A string leaf that is exactly one `{{token}}`
	 *  substitutes the RAW value (type-preserving); mixed strings interpolate. */
	body?: unknown;
	method: ViewActionHttpMethod;
	path: string;
}

/** A user action the shell renders as a button (desktop) or an ActionPanel row
 *  (island). `intent` is an opaque token the shell echoes back to the app when the
 *  action fires — the app decides what it means. */
export interface ViewAction {
	/** Confirmation prompt the shell shows before firing (destructive actions). */
	confirm?: string;
	/** Declarative HTTP handler — when present, the shell executes it directly
	 *  (the CRUD tier); otherwise the action is relayed to the owning app as a
	 *  `view.action` intent over the plugin host bridge. */
	http?: ViewActionHttp;
	/** Icon hint (a name the surface resolves; unknown = no icon). */
	icon?: string;
	id: string;
	/** Opaque command token echoed to the app on activation. */
	intent?: string;
	label: string;
	/** Opaque JSON echoed back to the app alongside `intent` on activation. */
	payload?: unknown;
	style?: ViewActionStyle;
}

/**
 * The context the shell passes with every fired action. `values` is the
 * collected form state (the **form submit contract**: a `Record<string,unknown>`
 * keyed by field id); `item` is the selected/owning list or table row — the RAW
 * source row when the view is source-fetched, else the declared item's fields.
 */
export interface ViewActionContext {
	/** The selected/owning list or table item. */
	item?: Record<string, unknown>;
	/** Collected form values, keyed by field id. */
	values?: Record<string, unknown>;
	/** The owning view contribution id (set by the page/panel wrapper). */
	viewId?: string;
}

/** A small status pill. */
export interface ViewBadge {
	label: string;
	tone?: ViewTone;
}

/** One row of a `list-detail` list: a title with optional supporting text, badges,
 *  a trailing accessory string, and its own row-scoped actions. */
export interface ViewItem {
	/** Trailing metadata (e.g. a timestamp or count). */
	accessory?: string;
	actions?: ViewAction[];
	badges?: ViewBadge[];
	/** Longer text shown in the detail pane (desktop) / expanded row (island). */
	detail?: string;
	id: string;
	subtitle?: string;
	title: string;
}

/** A `data-table` column header. `align` defaults to `left`. */
export interface ViewColumn {
	align?: "left" | "center" | "right";
	header: string;
	id: string;
}

/** A `data-table` row: cell values keyed by column id, plus optional badges/actions. */
export interface ViewRow {
	actions?: ViewAction[];
	badges?: ViewBadge[];
	cells: Record<string, string | number>;
	id: string;
}

/** A `form` field. `select` uses `options`; `switch` uses a boolean `value`. */
export interface ViewField {
	id: string;
	label: string;
	options?: { label: string; value: string }[];
	placeholder?: string;
	required?: boolean;
	type: "text" | "textarea" | "number" | "select" | "switch";
	value?: string | number | boolean;
}

/** A `filter-bar` control — a labelled option set the app filters on. */
export interface ViewFilter {
	id: string;
	label: string;
	options: { label: string; value: string }[];
	value?: string;
}

/** A `stat-card-row` tile: a headline value with an optional delta and tone. */
export interface StatCard {
	/** e.g. `"+12%"` — a secondary caption under the value. */
	delta?: string;
	id: string;
	label: string;
	tone?: ViewTone;
	value: string | number;
}

// ── Data sources (renderer-fetched; specs stay static manifest constants) ─────

/**
 * A declarative **data source** for a `list-detail` view. Specs are static
 * manifest constants, so live data comes from the RENDERER fetching this source
 * at mount (desktop + island both) through the host's authenticated Core seam,
 * then mapping response rows to {@link ViewItem}s via {@link ViewSourceMap}.
 * This is what makes a CRUD view live without a spec-provider round-trip.
 */
export interface ViewSource {
	http: {
		/** Defaults to `GET`. */
		method?: ViewActionHttpMethod;
		/** Core-relative path; must start with `/api/` ({@link isCoreApiPath}). */
		path: string;
	};
	/** Key of the row array in the response object. Absent = the response itself
	 *  is the array, else the first array-valued property is used. */
	items?: string;
	/** Field-map from {@link ViewItem} fields to response-row keys. */
	map?: ViewSourceMap;
}

/** Maps each {@link ViewItem} field to the response-row key it reads. Defaults:
 *  `id` → `"id"`, `title` → `"title"`; the rest are omitted unless mapped. */
export interface ViewSourceMap {
	accessory?: string;
	detail?: string;
	id?: string;
	subtitle?: string;
	title?: string;
}

/** One source-fetched row: the mapped {@link ViewItem} plus the RAW response row
 *  (the `{{item.<key>}}` templating base for actions fired on it). */
export interface SourceItem {
	item: ViewItem;
	raw: Record<string, unknown>;
}

/**
 * The opaque `spec` of a manifest `sidebar_sections` contribution (the Rust
 * `SidebarSectionContribution`). The desktop's compact sidebar renderer reads it so
 * an app owns its sidebar section instead of the shell hardcoding it:
 * - `source` supplies the live rows, fetched through the host's authenticated Core
 *   seam and mapped via {@link sourceItemsFromResponse} — the same primitive a
 *   `list-detail` view uses.
 * - `itemTarget` is a route template opened via `openTab`, filled with the clicked
 *   row using {@link renderTemplate} (e.g. `"/spaces/{{item.spaceId}}/canvas/{{item.id}}"`).
 *   Client navigation is not expressible as a {@link ViewAction}, so it lives here.
 * - `itemActions` are per-row context-menu actions (reusing {@link ViewAction}).
 * - `create` is the "+" action; its response id (`targetFrom`) feeds `itemTarget`
 *   to open the new row (create-and-open), else the section re-fetches its source.
 */
export interface SidebarSectionSpec {
	create?: {
		http: ViewActionHttp;
		icon?: string;
		label?: string;
		/** Response key holding the created row's id; feeds `itemTarget` to open it.
		 *  Absent = create then re-fetch (no auto-open). */
		targetFrom?: string;
	};
	/** Per-row context-menu actions (delete, rename, …). */
	itemActions?: ViewAction[];
	/**
	 * Optional hover preview for each row. Templates use the same `{{item.*}}`
	 * vocabulary as `itemTarget`. When set, the shell shows a right-side
	 * HoverCard with the full title (wrapping) plus optional description/meta
	 * instead of an overflow-only tooltip.
	 */
	itemPreview?: {
		/** Longer body under the title (e.g. `{{item.summary}}`). */
		description?: string;
		/** Key/value rows under the description (branch, path, …). */
		meta?: Array<{ label: string; value: string }>;
		/** Override the preview title template; defaults to the row's display title. */
		title?: string;
	};
	/** Route template opened when a row is clicked. */
	itemTarget?: string;
	/** Live rows for the section (same primitive `list-detail` uses). */
	source?: ViewSource;
}

/** The render-mode vocabulary of a manifest `dock_panels` contribution — the
 *  discriminant the desktop dock renderer switches on. Mirrors the vocabulary
 *  documented on the Rust `DockPanelContribution::panel`, which keeps the field a
 *  bare string so an unknown member survives an older Core intact. */
/** Maps a {@link StoreCatalogItem}'s fields to the response-row keys they read.
 *  Extends {@link ViewSourceMap} with the card-specific fields a marketplace row
 *  needs. Defaults: `id` → `"id"`, `title` → `"name"` then `"title"`,
 *  `description` → `"description"`. */
export interface StoreItemMap {
	/** Row key holding a short badge string (a pattern, a duration, a kind). */
	badge?: string;
	/** Row key holding the card's supporting text. */
	description?: string;
	/** Row key holding a per-item glyph id, overriding the tab's icon. */
	icon?: string;
	id?: string;
	/** Row key holding a boolean "already installed" flag. */
	installed?: string;
	/** Row key holding an external "learn more" URL shown in the detail pane. */
	sourceUrl?: string;
	/** Row key holding a string[] of tags rendered as outline badges. */
	tags?: string;
	title?: string;
}

/** How a {@link StoreTabSpec} item is installed — one declarative HTTP call plus
 *  what the shell does with the response. */
export interface StoreInstallSpec {
	/** The request. `{{item.<key>}}` resolves against the RAW catalog row. */
	http: ViewActionHttp;
	/** Button label; defaults to `"Install"`. */
	label?: string;
	/** Route template opened via `openTab` after a successful install. Resolves
	 *  `{{result.<key>}}` from the response and `{{item.<key>}}` from the row. */
	openTarget?: string;
	/** Toast title on success; defaults to `"Installed"`. */
	successMessage?: string;
	/** Response key holding the created resource's id, feeding `openTarget`. */
	targetFrom?: string;
}

/**
 * The opaque `spec` of a manifest `store_tabs` contribution (the Rust
 * `StoreTabContribution`). The desktop Store renders it so an app owns its
 * marketplace section instead of the shell hardcoding one — the same relationship
 * {@link SidebarSectionSpec} has to the sidebar, and it reuses the same primitives:
 * a {@link ViewSource} for the rows, `{{item.*}}` templating for actions, and
 * {@link ViewAction} for per-item extras.
 *
 * What a marketplace section needs beyond a sidebar list is grouping (cards fall
 * into labelled category rows), search over declared row keys, and an install
 * affordance with a post-install destination — hence {@link StoreTabSpec.groupBy},
 * {@link StoreTabSpec.searchFields} and {@link StoreTabSpec.install}.
 *
 * Search here is PER-TAB (the section's own search field). The store-wide
 * cross-realm search is a closed union of first-party realms and does not index
 * contributed tabs.
 */
export interface StoreTabSpec {
	/** Copy for the empty state. */
	empty?: { description?: string; title?: string };
	/** Row key whose value splits the cards into labelled sections. */
	groupBy?: string;
	/** Display order + labels for `groupBy` values. A value not listed here still
	 *  renders, in a trailing group titled by the raw value — an app must never
	 *  lose rows for forgetting a label. */
	groups?: { label: string; value: string }[];
	/** The install affordance. Absent = a browse-only tab. */
	install?: StoreInstallSpec;
	/** Extra per-item actions (card context menu + detail pane). */
	itemActions?: ViewAction[];
	/** Field-map from the card/detail fields to response-row keys. */
	map?: StoreItemMap;
	/** Extra row keys folded into the search haystack, on top of the mapped
	 *  title/description/tags. */
	searchFields?: string[];
	searchPlaceholder?: string;
	/** Live catalog rows (same primitive a `list-detail` view uses). */
	source?: ViewSource;
}

export const DOCK_PANEL_KINDS = ["companion", "view", "native"] as const;

export type DockPanelKind = (typeof DOCK_PANEL_KINDS)[number];

/**
 * The opaque `spec` of a manifest `dock_panels` contribution (the Rust
 * `DockPanelContribution`). Which key is read depends on the entry's `panel`
 * discriminant, so every field is optional:
 * - `panel: "companion"` reads {@link DockPanelSpec.companion} — the id of the
 *   companion runnable whose sandboxed surface mounts inside the dock chrome.
 * - `panel: "view"` reads {@link DockPanelSpec.view} — the id of one of the same
 *   plugin's `contributes.views` entries, rendered with the host's own components.
 * - `panel: "native"` reads nothing: the shell resolves its OWN component registered
 *   under `<plugin>/<id>`. That is the migration seam for first-party apps whose panel
 *   is hand-written React driving their sidecar through the ext-proxy (Browser,
 *   Simulator) — the component stays in the shell, but the tab's existence, label and
 *   placement become the app's declaration, so disabling the app removes the tab.
 *
 * `emptyText` is the placeholder a renderer shows before the panel has content (or
 * when a `native` panel has no registered component), and is read for every mode.
 */
export interface DockPanelSpec {
	/** Companion runnable id mounted by a `panel: "companion"` entry. */
	companion?: string;
	/** Placeholder shown while the panel has nothing to draw. */
	emptyText?: string;
	/** Id of a sibling `contributes.views` entry, for a `panel: "view"` entry. */
	view?: string;
}

// ── The discriminated union on `view` ─────────────────────────────────────────

export interface ListDetailView {
	/** Global actions (apply to the selection / the whole list). */
	actions?: ViewAction[];
	/** Shown when `items` is empty. */
	emptyText?: string;
	/** Actions attached to EVERY item (declared or source-fetched). Fired with
	 *  that item as `ctx.item`, so `{{item.<key>}}` templating resolves per row. */
	itemActions?: ViewAction[];
	items: ViewItem[];
	/** Renderer-fetched data source; when set, fetched rows replace `items`. */
	source?: ViewSource;
	view: "list-detail";
}

export interface DataTableView {
	actions?: ViewAction[];
	columns: ViewColumn[];
	emptyText?: string;
	rows: ViewRow[];
	view: "data-table";
}

export interface FormView {
	actions?: ViewAction[];
	fields: ViewField[];
	submit?: ViewAction;
	view: "form";
}

export interface ActionPanelView {
	actions: ViewAction[];
	title?: string;
	view: "action-panel";
}

export interface FilterBarView {
	filters: ViewFilter[];
	view: "filter-bar";
}

export interface EmptyStateView {
	action?: ViewAction;
	description?: string;
	icon?: string;
	title: string;
	view: "empty-state";
}

export interface StatCardRowView {
	stats: StatCard[];
	view: "stat-card-row";
}

/** Any view spec. The `view` discriminant selects the renderer branch. */
export type ViewSpec =
	| ListDetailView
	| DataTableView
	| FormView
	| ActionPanelView
	| FilterBarView
	| EmptyStateView
	| StatCardRowView;

/** The wire envelope Core forwards (mirrors Rust `ViewContribution`), tagged with the
 *  owning `plugin` id server-side. `spec` carries a {@link ViewSpec} (its own `view`
 *  duplicates the envelope `view` — the renderer trusts the spec's discriminant). */
export interface ViewContribution {
	id: string;
	/** Owning plugin id, added by Core's contributions endpoint. */
	plugin?: string;
	spec?: ViewSpec;
	title?: string;
	view: ViewKind | string;
}

// ── Templating + source mapping (pure, dependency-free) ───────────────────────

/** `{{token}}` — `token` is a form-field id or `item.<key>`. */
const TEMPLATE_TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** Matches a string that is EXACTLY one template token (raw substitution). */
const SOLE_TEMPLATE_TOKEN = /^\{\{\s*([\w.-]+)\s*\}\}$/;

function resolveToken(token: string, ctx: ViewActionContext): unknown {
	if (token.startsWith("item.")) {
		return ctx.item?.[token.slice("item.".length)];
	}
	return ctx.values?.[token];
}

function stringifyToken(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}
	return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * Interpolate `{{field}}` (form values) and `{{item.<key>}}` (selected item)
 * tokens into `template`. `uriEncode` encodes each substituted value as a URI
 * component — required for paths, where a row id must never break the route.
 */
export function renderTemplate(
	template: string,
	ctx: ViewActionContext,
	opts?: { uriEncode?: boolean }
): string {
	return template.replace(TEMPLATE_TOKEN, (_match, token: string) => {
		const text = stringifyToken(resolveToken(token, ctx));
		return opts?.uriEncode ? encodeURIComponent(text) : text;
	});
}

/** Recursively template a JSON body: a string leaf that is exactly one token
 *  substitutes the RAW value (type-preserving); mixed strings interpolate. */
function renderBody(body: unknown, ctx: ViewActionContext): unknown {
	if (typeof body === "string") {
		const sole = SOLE_TEMPLATE_TOKEN.exec(body);
		if (sole?.[1]) {
			return resolveToken(sole[1], ctx);
		}
		return renderTemplate(body, ctx);
	}
	if (Array.isArray(body)) {
		return body.map((entry) => renderBody(entry, ctx));
	}
	if (isRecord(body)) {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(body)) {
			out[key] = renderBody(value, ctx);
		}
		return out;
	}
	return body;
}

/** True when `path` is a safe Core-relative API path a declarative action or
 *  source may target: it must start with `/api/` and contain no `..` segment,
 *  so a spec can never point the host's node credentials elsewhere. */
export function isCoreApiPath(path: string): boolean {
	return (
		path.startsWith("/api/") &&
		!path.split("/").some((segment) => segment === "..")
	);
}

/** A fully-rendered declarative HTTP action, ready for the host's fetch seam. */
export interface RenderedActionHttp {
	body?: unknown;
	method: ViewActionHttpMethod;
	path: string;
}

/**
 * Render a {@link ViewActionHttp} against the fired action's context: the path
 * templates with URI-encoding, the body templates type-preservingly. Throws when
 * the rendered path is not a Core-relative `/api/` path ({@link isCoreApiPath}).
 */
export function renderActionHttp(
	http: ViewActionHttp,
	ctx: ViewActionContext
): RenderedActionHttp {
	const path = renderTemplate(http.path, ctx, { uriEncode: true });
	if (!isCoreApiPath(path)) {
		throw new Error(`declarative action path must start with /api/: ${path}`);
	}
	return {
		method: http.method,
		path,
		body: http.body === undefined ? undefined : renderBody(http.body, ctx),
	};
}

function rowText(
	row: Record<string, unknown>,
	key: string | undefined
): string | undefined {
	if (!key) {
		return undefined;
	}
	const value = row[key];
	if (value === null || value === undefined) {
		return undefined;
	}
	return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * Map a source-fetch response payload to renderable {@link SourceItem}s per the
 * source's `items` key + field-map. Deliberately forgiving: rows without a
 * usable id/title are skipped, a non-array payload yields `[]` — a bad backend
 * response degrades to the empty state, never a crash.
 */
export function sourceItemsFromResponse(
	source: ViewSource,
	payload: unknown
): SourceItem[] {
	let rows: unknown;
	if (Array.isArray(payload)) {
		rows = payload;
	} else if (isRecord(payload)) {
		rows = source.items
			? payload[source.items]
			: Object.values(payload).find((v) => Array.isArray(v));
	}
	if (!Array.isArray(rows)) {
		return [];
	}
	const map = source.map ?? {};
	const out: SourceItem[] = [];
	for (const row of rows) {
		if (!isRecord(row)) {
			continue;
		}
		const id = rowText(row, map.id ?? "id");
		const title = rowText(row, map.title ?? "title");
		if (!(id && title)) {
			continue;
		}
		out.push({
			raw: row,
			item: {
				id,
				title,
				subtitle: rowText(row, map.subtitle),
				detail: rowText(row, map.detail),
				accessory: rowText(row, map.accessory),
			},
		});
	}
	return out;
}

/** One catalog row a {@link StoreTabSpec} renders as a card, plus the RAW response
 *  row that `{{item.<key>}}` templating resolves against. */
export interface StoreCatalogItem {
	badge?: string;
	description?: string;
	/** The `groupBy` value this row fell into ("" when the tab is ungrouped). */
	group: string;
	icon?: string;
	id: string;
	/** True when the row itself reports the item is already installed. */
	installed: boolean;
	raw: Record<string, unknown>;
	sourceUrl?: string;
	tags: string[];
	title: string;
}

function rowStrings(row: Record<string, unknown>, key?: string): string[] {
	if (!key) {
		return [];
	}
	const value = row[key];
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((v): v is string => typeof v === "string");
}

/**
 * Map a catalog response to renderable {@link StoreCatalogItem}s per the tab's
 * `source.items` key and `map`. Forgiving in the same way
 * {@link sourceItemsFromResponse} is — a row without a usable id/title is skipped
 * and a non-array payload yields `[]`, so a backend the shell cannot parse degrades
 * to the empty state rather than a crash.
 *
 * `title` falls back through `name` → `title` because catalog payloads across the
 * first-party apps use both spellings, and an app should not have to declare a `map`
 * for the common case.
 */
export function storeItemsFromResponse(
	spec: StoreTabSpec,
	payload: unknown
): StoreCatalogItem[] {
	const source = spec.source;
	let rows: unknown;
	if (Array.isArray(payload)) {
		rows = payload;
	} else if (isRecord(payload)) {
		rows = source?.items
			? payload[source.items]
			: Object.values(payload).find((v) => Array.isArray(v));
	}
	if (!Array.isArray(rows)) {
		return [];
	}
	const map = spec.map ?? {};
	const out: StoreCatalogItem[] = [];
	for (const row of rows) {
		if (!isRecord(row)) {
			continue;
		}
		const id = rowText(row, map.id ?? "id");
		const title =
			rowText(row, map.title ?? "name") ?? rowText(row, map.title ?? "title");
		if (!(id && title)) {
			continue;
		}
		out.push({
			badge: rowText(row, map.badge),
			description: rowText(row, map.description ?? "description"),
			group: spec.groupBy ? (rowText(row, spec.groupBy) ?? "") : "",
			icon: rowText(row, map.icon),
			id,
			installed: map.installed ? row[map.installed] === true : false,
			raw: row,
			sourceUrl: rowText(row, map.sourceUrl),
			tags: rowStrings(row, map.tags),
			title,
		});
	}
	return out;
}

/** The searchable haystack for one catalog item: its title, description, badge,
 *  tags and any extra `searchFields` row keys, lowercased and joined. */
export function storeItemHaystack(
	spec: StoreTabSpec,
	item: StoreCatalogItem
): string {
	const parts = [item.title, item.description, item.badge, ...item.tags];
	for (const key of spec.searchFields ?? []) {
		parts.push(rowText(item.raw, key));
	}
	return parts.filter(Boolean).join(" ").toLowerCase();
}

/** A labelled card section produced by {@link groupStoreItems}. */
export interface StoreCatalogGroup {
	items: StoreCatalogItem[];
	label: string;
	value: string;
}

/**
 * Split items into the tab's declared `groups`, in declared order, then append one
 * trailing group per `groupBy` value the spec did not declare (labelled by the raw
 * value). Undeclared values are NEVER dropped: an app that adds a category to its
 * backend before updating its manifest would otherwise silently lose those cards.
 * An ungrouped tab yields a single unlabelled group.
 */
export function groupStoreItems(
	spec: StoreTabSpec,
	items: StoreCatalogItem[]
): StoreCatalogGroup[] {
	if (!spec.groupBy) {
		return items.length ? [{ items, label: "", value: "" }] : [];
	}
	const declared = spec.groups ?? [];
	const seen = new Set(declared.map((g) => g.value));
	const out: StoreCatalogGroup[] = declared.map((g) => ({
		items: items.filter((i) => i.group === g.value),
		label: g.label,
		value: g.value,
	}));
	for (const item of items) {
		if (seen.has(item.group)) {
			continue;
		}
		seen.add(item.group);
		out.push({
			items: items.filter((i) => i.group === item.group),
			label: item.group || "Other",
			value: item.group,
		});
	}
	return out.filter((g) => g.items.length > 0);
}

// ── Validation (pure, dependency-free) ────────────────────────────────────────

/** Result of {@link validateView}: `ok` plus a flat list of human-readable errors. */
export interface ViewValidation {
	errors: string[];
	ok: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

/** True when `kind` is one of the seven known {@link VIEW_KINDS}. */
export function isKnownViewKind(kind: unknown): kind is ViewKind {
	return (
		typeof kind === "string" && (VIEW_KINDS as readonly string[]).includes(kind)
	);
}

/**
 * Structurally validate a value as a {@link ViewSpec}. This is the shared gate a
 * renderer runs before dispatch: it checks the `view` discriminant is known and that
 * the payload carries the required collection for that kind. It is deliberately shallow
 * (shape, not deep field types) — the renderers tolerate missing optional fields — so a
 * newer app targeting an older shell degrades to a known-kind empty view rather than a
 * crash.
 */
export function validateView(value: unknown): ViewValidation {
	const errors: string[] = [];
	if (!isRecord(value)) {
		return { ok: false, errors: ["view spec must be an object"] };
	}
	const kind = value.view;
	if (!isKnownViewKind(kind)) {
		return {
			ok: false,
			errors: [`unknown view kind: ${JSON.stringify(kind)}`],
		};
	}
	const requireArray = (key: string) => {
		if (!Array.isArray((value as Record<string, unknown>)[key])) {
			errors.push(`${kind}: "${key}" must be an array`);
		}
	};
	switch (kind) {
		case "list-detail":
			requireArray("items");
			break;
		case "data-table":
			requireArray("columns");
			requireArray("rows");
			break;
		case "form":
			requireArray("fields");
			break;
		case "action-panel":
			requireArray("actions");
			break;
		case "filter-bar":
			requireArray("filters");
			break;
		case "empty-state":
			if (typeof value.title !== "string" || value.title.length === 0) {
				errors.push('empty-state: "title" must be a non-empty string');
			}
			break;
		case "stat-card-row":
			requireArray("stats");
			break;
		default:
			break;
	}
	return { ok: errors.length === 0, errors };
}

// ── The reference example: a "hello list-detail" spec ─────────────────────────

/** The minimal proof spec rendered in both the desktop and island harnesses — a
 *  three-item list with a detail body and one primary action. Kept tiny on purpose:
 *  it is the load-bearing "one spec, two renderers" demonstration. */
export const helloListDetail: ListDetailView = {
	view: "list-detail",
	items: [
		{
			id: "alpha",
			title: "Alpha",
			subtitle: "The first letter",
			detail: "Alpha is where the list begins. Selecting it shows this detail.",
			badges: [{ label: "new", tone: "success" }],
			accessory: "1",
		},
		{
			id: "beta",
			title: "Beta",
			subtitle: "The second letter",
			detail: "Beta demonstrates a second row with its own detail body.",
			accessory: "2",
		},
		{
			id: "gamma",
			title: "Gamma",
			subtitle: "The third letter",
			detail: "Gamma closes out the hello example.",
			badges: [{ label: "draft", tone: "warning" }],
			accessory: "3",
		},
	],
	actions: [
		{ id: "refresh", label: "Refresh", style: "primary", icon: "refresh" },
	],
	emptyText: "Nothing here yet.",
};

/** The example wrapped as a {@link ViewContribution} — what a plugin's manifest
 *  `contributes.views[]` entry looks like on the wire. */
export const helloListDetailContribution: ViewContribution = {
	id: "hello",
	title: "Hello",
	view: "list-detail",
	spec: helloListDetail,
};
