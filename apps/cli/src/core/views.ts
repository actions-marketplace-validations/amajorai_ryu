// The declarative-view VOCABULARY, projected for the terminal.
//
// A plugin never ships UI code to a host shell. It declares `contributes.views[]`
// in its manifest: a typed envelope (id/title/view) around an OPAQUE `spec` that is
// pure DATA — items, columns, actions, fields — tagged by one of seven kinds
// (list-detail, data-table, form, action-panel, filter-bar, empty-state,
// stat-card-row). Each host renders that SAME spec with its own idiom: real
// @ryu/ui components on the desktop, a compact Raycast-style panel on the island,
// a keyboard-driven list in this terminal. One spec, N renderers.
//
// `packages/app-host/src/views.ts` is the single source of truth for the
// vocabulary. It is MIRRORED here rather than imported because the TUI is a
// bun-run CLI whose only workspace dependency is `@ryuhq/core-client`
// (see package.json) — the same reason every other Core payload it consumes is
// projected locally from the wire shape (see the `*Wire` interfaces in
// src/tabs/apps.tsx). The mirror is not allowed to drift: the drift-guard block of
// src/__tests__/contributions.test.ts imports the source-of-truth helpers directly
// and asserts this module agrees with them field for field, so a change upstream
// fails the TUI test suite rather than silently rendering the wrong thing.
//
// Everything here is pure and dependency-free; the renderer lives in
// src/ui/DeclarativeView.tsx and the Core-backed shell in src/ui/ContributedView.tsx.

/** The seven standardized view kinds — the discriminant a renderer switches on. */
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

/** Visual tone shared by badges and stats, mapped by each renderer to its own
 *  palette (a `@ryu/ui` Badge variant on desktop, a themed termcn Badge here). */
export type ViewTone = "neutral" | "success" | "warning" | "danger" | "info";

/** How prominent an action is. `primary` is the default/confirm affordance (the
 *  one Enter fires here); `danger` is destructive; `default` is secondary. */
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

/** A declarative HTTP handler for a {@link ViewAction} — the CRUD tier that makes
 *  actions work with NO per-app sidecar code. The host executes the request through
 *  its own authenticated Core seam (the spec never sees a token); `path` and string
 *  leaves of `body` template from the collected form values and the selected item. */
export interface ViewActionHttp {
	body?: unknown;
	method: ViewActionHttpMethod;
	path: string;
}

/** A user action, rendered as a numbered entry in the terminal's command row.
 *  `intent` is an opaque token the shell echoes back to the owning app. */
export interface ViewAction {
	/** Confirmation prompt shown before firing (destructive actions). */
	confirm?: string;
	/** When present the host executes this directly (the CRUD tier); otherwise the
	 *  action is relayed to the owning app as a `view.action` intent. */
	http?: ViewActionHttp;
	/** Icon hint (a name the surface resolves; unknown = no icon). */
	icon?: string;
	id: string;
	intent?: string;
	label: string;
	payload?: unknown;
	style?: ViewActionStyle;
}

/** The context the host passes with every fired action: the collected form
 *  `values`, the selected/owning row (`item` — the RAW source row when the view is
 *  source-fetched), and the owning contribution id. */
export interface ViewActionContext {
	item?: Record<string, unknown>;
	values?: Record<string, unknown>;
	viewId?: string;
}

/** A small status pill. */
export interface ViewBadge {
	label: string;
	tone?: ViewTone;
}

/** One row of a `list-detail` list. */
export interface ViewItem {
	accessory?: string;
	actions?: ViewAction[];
	badges?: ViewBadge[];
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

/** A `data-table` row: cell values keyed by column id. */
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

/** A `stat-card-row` tile. */
export interface StatCard {
	delta?: string;
	id: string;
	label: string;
	tone?: ViewTone;
	value: string | number;
}

/** A declarative data source for a `list-detail` view. Specs are static manifest
 *  constants, so live data comes from the RENDERER's host fetching this at mount
 *  through its authenticated Core seam and mapping rows via {@link ViewSourceMap}. */
export interface ViewSource {
	http: {
		/** Defaults to `GET`. */
		method?: ViewActionHttpMethod;
		/** Core-relative path; must satisfy {@link isCoreApiPath}. */
		path: string;
	};
	/** Key of the row array in the response object. Absent = the response itself is
	 *  the array, else the first array-valued property is used. */
	items?: string;
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

// ── The discriminated union on `view` ────────────────────────────────────────

export interface ListDetailView {
	actions?: ViewAction[];
	emptyText?: string;
	/** Actions attached to EVERY item, fired with that item as `ctx.item`. */
	itemActions?: ViewAction[];
	items: ViewItem[];
	/** Host-fetched data source; when set, fetched rows replace `items`. */
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

// ── Templating + source mapping (pure) ───────────────────────────────────────

/** `{{token}}` — `token` is a form-field id or `item.<key>`. */
const TEMPLATE_TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** Matches a string that is EXACTLY one template token (raw substitution). */
const SOLE_TEMPLATE_TOKEN = /^\{\{\s*([\w.-]+)\s*\}\}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null;

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

/** Interpolate `{{field}}` (form values) and `{{item.<key>}}` (selected item)
 *  tokens into `template`. `uriEncode` encodes each substituted value as a URI
 *  component — required for paths, where a row id must never break the route. */
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
 *  source may target: it must start with `/api/` and contain no `..` segment, so a
 *  spec can never point the node's credentials somewhere else. */
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

/** Render a {@link ViewActionHttp} against the fired action's context: the path
 *  templates with URI-encoding, the body templates type-preservingly. Throws when
 *  the rendered path is not a Core-relative `/api/` path. */
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

/** Map a source-fetch response payload to renderable {@link SourceItem}s per the
 *  source's `items` key + field-map. Deliberately forgiving: rows without a usable
 *  id/title are skipped and a non-array payload yields `[]`, so a bad backend
 *  response degrades to the empty state rather than crashing the shell. */
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

/** True when `kind` is one of the seven known {@link VIEW_KINDS}. An unknown kind
 *  is NOT an error: Core passes new kinds through verbatim, so an older shell
 *  renders a readable "unsupported view" fallback instead of failing. */
export function isKnownViewKind(kind: unknown): kind is ViewKind {
	return (
		typeof kind === "string" && (VIEW_KINDS as readonly string[]).includes(kind)
	);
}

// ── Validation (pure) ────────────────────────────────────────────────────────

/** Result of {@link validateView}: `ok` plus a flat list of human-readable errors. */
export interface ViewValidation {
	errors: string[];
	ok: boolean;
}

/**
 * Structurally validate a value as a {@link ViewSpec} — the gate every renderer runs
 * before dispatch. `spec` is OPAQUE to Core (the Rust `ViewContribution` forwards it
 * verbatim), so a manifest can declare `{"view": "list-detail"}` with no `items`, and
 * a renderer that trusts the discriminant alone dereferences `undefined` and takes the
 * whole shell down with it — in a terminal that means the app's root error boundary,
 * not one broken pane. Checking the required collection here turns that into a
 * readable line.
 *
 * Deliberately shallow (shape, not deep field types): the renderers tolerate missing
 * OPTIONAL fields, so a newer app targeting an older shell degrades to a known-kind
 * empty view rather than an error.
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
