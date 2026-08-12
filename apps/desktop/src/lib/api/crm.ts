// The desktop client for Harbor (`@ryu/crm`) — the object-first CRM sidecar.
//
// This is a `panel: "native"` dock contribution (the `@ryu/browser` /
// `@ryu/simulator` / `@ryu/ugc` precedent), NOT a sandboxed companion, so the panel
// reaches the sidecar over ordinary `fetch` against Core's proxy. A companion frame
// runs under CSP `connect-src 'none'` and could only reach the sidecar through
// per-app RPC verbs in `rpc.ts` + `kernel-contracts` — exactly the per-app Core
// coupling an apps-store satellite must not require. Nothing here touches that
// bridge, which is why adding Harbor cost Core two generic registration lines.
//
// Data path: `/api/crm/*` DIRECTLY. The manifest declares `http.public_mount`, so
// Core mounts the sidecar at that prefix. Every path below must ALSO appear in the
// manifest's `sidecars[0].http.routes[]` — Core's ext-proxy 404s an undeclared path
// before it ever reaches the sidecar, so a route added here and forgotten there
// fails at runtime with a 404 that looks like a missing handler.
//
// Casing: the sidecar serializes snake_case and these types mirror it verbatim
// rather than camel-casing at the boundary. That is deliberate and matches
// `UgcPanel`: field values are keyed by USER-DEFINED field slugs inside `values`,
// so a blanket key transform would rewrite user data — a field a user named
// `first_name` would silently become `firstName` on the way in and fail to match on
// the way back out. Rather than special-case the value bag inside a general
// transform, the whole surface stays snake_case.
//
// Money is integer cents on the wire and stays integer until the render edge
// divides once. No currency arithmetic happens in floats.

import type { ApiTarget } from "@/src/lib/api/client.ts";
import { apiUrl, makeHeaders } from "@/src/lib/api/client.ts";

/** The app that owns this surface. Feature detection keys off it. */
export const CRM_PLUGIN_ID = "@ryu/crm";

/** The sidecar's public mount. Every path below is relative to this. */
const CRM_BASE = "/api/crm";

// ── Wire types ───────────────────────────────────────────────────────────────
// Optional fields are optional on purpose: the panel degrades to a placeholder
// rather than crashing when the sidecar is a version ahead of or behind this build.

/** Every field type the schema editor can create. Kept as a union rather than an
 *  enum so an unknown type from a newer sidecar narrows to `string` at the render
 *  edge instead of throwing. */
export type FieldType =
	| "checkbox"
	| "currency"
	| "date"
	| "datetime"
	| "email"
	| "long_text"
	| "multi_select"
	| "number"
	| "percent"
	| "phone"
	| "rating"
	| "relation"
	| "select"
	| "status"
	| "text"
	| "url"
	| "user";

export type ViewKind = "board" | "list" | "table";

export type ActivityKind =
	| "call"
	| "field_change"
	| "meeting"
	| "note"
	| "stage_change"
	| "task";

/** A choice on a select/status/multi_select field.
 *
 *  `is_won` / `is_lost` are only meaningful on a `status` field: they are what let
 *  the pipeline report compute a win rate without anyone hardcoding the string
 *  "Won", and what lets a board hide closed columns. */
export interface SelectOption {
	color?: string | null;
	id: string;
	is_lost?: boolean;
	is_won?: boolean;
	label: string;
	position: number;
}

export interface FieldConfig {
	currency_code?: string | null;
	default_value?: unknown;
	max_length?: number | null;
	max_rating?: number | null;
	options?: SelectOption[];
	precision?: number | null;
	relation_inverse_label?: string | null;
	relation_multiple?: boolean;
	relation_object_id?: string | null;
}

export interface Field {
	config?: FieldConfig;
	created_at: string;
	description?: string | null;
	field_type: FieldType;
	id: string;
	is_required: boolean;
	is_system: boolean;
	is_unique: boolean;
	/** Set only for a LIST-specific field — an attribute that exists inside one
	 *  curated list rather than on the object itself. Null for an object field. */
	list_id?: string | null;
	name: string;
	object_id: string;
	position: number;
	slug: string;
	updated_at: string;
}

export interface CrmObject {
	created_at: string;
	description?: string | null;
	icon?: string | null;
	id: string;
	is_standard: boolean;
	plural: string;
	position: number;
	singular: string;
	slug: string;
	/** Which field renders as the record's title. Optional because a freshly
	 *  created custom object may not have one yet. */
	title_field_id?: string | null;
	updated_at: string;
}

export type SortDirection = "asc" | "desc";

export interface ViewSort {
	direction?: SortDirection;
	field_id: string;
}

/** Externally tagged, exactly as the sidecar's `ViewFilter` serializes: a filter is
 *  a TREE, not a flat list, so `and`/`or`/`not` nest arbitrarily. */
export type ViewFilter =
	| { and: { filters: ViewFilter[] } }
	| { condition: FilterCondition }
	| { not: { filter: ViewFilter } }
	| { or: { filters: ViewFilter[] } };

export interface FilterCondition {
	field_id: string;
	op: string;
	value: unknown;
}

export interface View {
	created_at: string;
	filter?: ViewFilter | null;
	/** Which field a board groups its columns by. Required in practice for
	 *  `kind: "board"`; null on a table or list view. */
	group_by_field_id?: string | null;
	id: string;
	is_default: boolean;
	kind: ViewKind;
	name: string;
	object_id: string;
	position: number;
	sorts?: ViewSort[];
	updated_at: string;
	visible_field_ids?: string[];
}

/** A record's field values, keyed by field SLUG.
 *
 *  `unknown` rather than a union because the value's shape is decided by its
 *  field's type at runtime, and narrowing belongs at the one render/edit seam that
 *  already knows the field. */
export type ValueBag = Record<string, unknown>;

export interface CrmRecord {
	created_at: string;
	created_by?: string | null;
	/** Non-null means SOFT-deleted and restorable, which is a different state from
	 *  absent. The list routes exclude these unless `include_deleted` is set. */
	deleted_at?: string | null;
	id: string;
	object_id: string;
	title: string;
	updated_at: string;
	values?: ValueBag;
}

export interface CrmList {
	created_at: string;
	description?: string | null;
	icon?: string | null;
	id: string;
	name: string;
	object_id: string;
	position: number;
	updated_at: string;
}

export interface ListEntry {
	created_at: string;
	id: string;
	list_id: string;
	position: number;
	record_id: string;
	updated_at: string;
	/** The LIST-specific values — a deal's stage inside this one sales list, kept
	 *  separate from the object's own status field on purpose. */
	values?: ValueBag;
}

export interface Activity {
	assignee?: string | null;
	author?: string | null;
	body?: string | null;
	completed_at?: string | null;
	created_at: string;
	due_at?: string | null;
	/** Set on `field_change` / `stage_change` entries, which the STORE writes on
	 *  every mutation — they are an audit trail, not something a user authors. */
	field_id?: string | null;
	from_value?: unknown;
	id: string;
	kind: ActivityKind;
	object_id?: string | null;
	record_id?: string | null;
	title?: string;
	to_value?: unknown;
	updated_at: string;
}

export interface ObjectWithFields {
	fields: Field[];
	object: CrmObject;
	record_count: number;
	views: View[];
}

export interface SchemaResponse {
	lists: CrmList[];
	objects: ObjectWithFields[];
}

export interface Page<T> {
	has_more: boolean;
	items: T[];
	limit: number;
	offset: number;
	total: number;
}

export interface SearchHit {
	object_id: string;
	object_slug: string;
	rank: number;
	record_id: string;
	snippet: string;
	title: string;
}

export interface PipelineStage {
	color?: string | null;
	is_lost: boolean;
	is_won: boolean;
	label: string;
	option_id: string;
	position: number;
	record_count: number;
	share: number;
	value_cents: number;
}

export interface PipelineReport {
	currency_code: string;
	field_id: string;
	lost_count: number;
	lost_value_cents: number;
	object_id: string;
	stages: PipelineStage[];
	total_records: number;
	total_value_cents: number;
	unassigned_count: number;
	value_field_id?: string | null;
	win_rate: number;
	won_count: number;
	won_value_cents: number;
}

export interface ImportColumn {
	index: number;
	name: string;
	samples: string[];
	suggested_field_id?: string | null;
}

export interface ImportMapping {
	column_index: number;
	/** `null` means "do not import this column" — an explicit decision, distinct
	 *  from a column nobody has looked at yet. */
	field_id: string | null;
}

export interface ImportConflict {
	existing: unknown;
	field_id: string;
	field_slug: string;
	incoming: unknown;
	record_id: string;
	row_index: number;
}

export interface ImportPreview {
	conflicts?: ImportConflict[];
	create_count: number;
	error_count: number;
	skip_count: number;
	total_rows: number;
	/** True when the sample list was capped — the counts above are still exact for
	 *  the whole file, only the per-row detail is partial. */
	truncated?: boolean;
	unmapped_columns?: string[];
	update_count: number;
}

export interface ImportResult {
	created: number;
	created_record_ids?: string[];
	failed: number;
	skipped: number;
	updated: number;
	updated_record_ids?: string[];
}

export interface ImportJob {
	columns: ImportColumn[];
	created_at: string;
	dedupe?: { match_field_ids: string[]; strategy: string };
	delimiter: string;
	error?: string | null;
	filename?: string | null;
	has_header: boolean;
	id: string;
	mappings?: ImportMapping[];
	object_id: string;
	preview?: ImportPreview | null;
	result?: ImportResult | null;
	row_count: number;
	status: "applied" | "draft" | "failed" | "previewed";
	updated_at: string;
}

export interface RecordQuery {
	filter?: ViewFilter | null;
	include_deleted?: boolean;
	limit?: number;
	list_id?: string | null;
	object_id?: string;
	offset?: number;
	search?: string | null;
	sorts?: ViewSort[];
}

// ── Transport ────────────────────────────────────────────────────────────────

/** Thrown for any non-2xx. Carries the status so a caller can tell "the app is
 *  disabled" (the proxy 404s an unmounted plugin) from "that record is gone" (a
 *  handler 404) by looking at what it asked for. */
export class CrmError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "CrmError";
		this.status = status;
	}
}

interface RequestInitLite {
	body?: unknown;
	method?: string;
	/** Raw text body (CSV upload). Mutually exclusive with `body`. */
	raw?: string;
	signal?: AbortSignal;
}

async function send<T>(
	target: ApiTarget,
	path: string,
	init?: RequestInitLite
): Promise<T> {
	const headers = makeHeaders(target.token);
	if (init?.raw !== undefined) {
		headers["Content-Type"] = "text/csv";
	}
	const response = await fetch(apiUrl(target, `${CRM_BASE}${path}`), {
		body:
			init?.raw ??
			(init?.body === undefined ? undefined : JSON.stringify(init.body)),
		headers,
		method: init?.method ?? "GET",
		signal: init?.signal,
	});
	if (!response.ok) {
		// The sidecar's error type serializes `{error: "..."}`; a proxy-level
		// failure may not be JSON at all, so fall back to the status text rather
		// than letting a parse error mask the real one.
		let detail = response.statusText;
		try {
			const parsed = (await response.json()) as { error?: string };
			if (parsed?.error) {
				detail = parsed.error;
			}
		} catch {
			// Non-JSON body — keep the status text.
		}
		throw new CrmError(response.status, detail);
	}
	if (response.status === 204) {
		return undefined as T;
	}
	return (await response.json()) as T;
}

const enc = encodeURIComponent;

/**
 * Bind every endpoint to one node.
 *
 * A factory rather than free functions because the base URL and bearer come from
 * the ACTIVE NODE, which changes at runtime — Core listens on :7980 locally but the
 * selected node may be remote. Callers build this once per node with
 * `useMemo(() => createCrmClient(toTarget(node)), [node])` so a node switch
 * re-binds rather than silently querying the previous one.
 */
export function createCrmClient(target: ApiTarget) {
	return {
		// ── Schema ───────────────────────────────────────────────────────────
		/** The panel's boot call: every object with its fields, views and record
		 *  count, plus the curated lists. One round-trip, not N+1 per object. */
		getSchema: (signal?: AbortSignal) =>
			send<SchemaResponse>(target, "/schema", { signal }),

		createObject: (body: Partial<CrmObject>) =>
			send<CrmObject>(target, "/objects", { body, method: "POST" }),

		updateObject: (slug: string, body: Partial<CrmObject>) =>
			send<CrmObject>(target, `/objects/${enc(slug)}`, {
				body,
				method: "PATCH",
			}),

		deleteObject: (slug: string) =>
			send<void>(target, `/objects/${enc(slug)}`, { method: "DELETE" }),

		createField: (slug: string, body: Partial<Field>) =>
			send<Field>(target, `/objects/${enc(slug)}/fields`, {
				body,
				method: "POST",
			}),

		updateField: (fieldId: string, body: Partial<Field>) =>
			send<Field>(target, `/fields/${enc(fieldId)}`, {
				body,
				method: "PATCH",
			}),

		deleteField: (fieldId: string) =>
			send<void>(target, `/fields/${enc(fieldId)}`, { method: "DELETE" }),

		reorderFields: (slug: string, fieldIds: string[]) =>
			send<void>(target, `/objects/${enc(slug)}/fields/reorder`, {
				body: { field_ids: fieldIds },
				method: "POST",
			}),

		// ── Records ──────────────────────────────────────────────────────────
		/** The one read every grid and board goes through. Takes the SAME
		 *  filter/sort shape a view stores, so "run this view" and "run an ad-hoc
		 *  query" are one code path rather than two that can drift. */
		queryRecords: (slug: string, query: RecordQuery, signal?: AbortSignal) =>
			send<Page<CrmRecord>>(target, `/objects/${enc(slug)}/records/query`, {
				body: query,
				method: "POST",
				signal,
			}),

		createRecord: (slug: string, values: ValueBag) =>
			send<CrmRecord>(target, `/objects/${enc(slug)}/records`, {
				body: { values },
				method: "POST",
			}),

		getRecord: (recordId: string, signal?: AbortSignal) =>
			send<CrmRecord>(target, `/records/${enc(recordId)}`, { signal }),

		/** Merges: fields not named are left alone, so a single-cell edit sends one
		 *  key and cannot clobber a column the grid was not showing. */
		updateRecord: (recordId: string, values: ValueBag) =>
			send<CrmRecord>(target, `/records/${enc(recordId)}`, {
				body: { mode: "merge", values },
				method: "PATCH",
			}),

		deleteRecord: (recordId: string) =>
			send<void>(target, `/records/${enc(recordId)}`, { method: "DELETE" }),

		restoreRecord: (recordId: string) =>
			send<CrmRecord>(target, `/records/${enc(recordId)}/restore`, {
				method: "POST",
			}),

		getRelated: (recordId: string, signal?: AbortSignal) =>
			send<{ groups: RelatedGroup[] }>(
				target,
				`/records/${enc(recordId)}/related`,
				{ signal }
			),

		link: (recordId: string, fieldId: string, targetIds: string[]) =>
			send<void>(target, `/records/${enc(recordId)}/links`, {
				body: { field_id: fieldId, target_ids: targetIds },
				method: "POST",
			}),

		unlink: (recordId: string, fieldId: string, targetIds: string[]) =>
			send<void>(target, `/records/${enc(recordId)}/unlink`, {
				body: { field_id: fieldId, target_ids: targetIds },
				method: "POST",
			}),

		findDuplicates: (slug: string, signal?: AbortSignal) =>
			send<{ groups: DuplicateGroup[] }>(
				target,
				`/objects/${enc(slug)}/duplicates`,
				{ signal }
			),

		mergeRecords: (body: {
			loser_ids: string[];
			resolutions?: { field_id: string; source: string }[];
			survivor_id: string;
		}) => send<CrmRecord>(target, "/merge", { body, method: "POST" }),

		// ── Views & lists ────────────────────────────────────────────────────
		createView: (slug: string, body: Partial<View>) =>
			send<View>(target, `/objects/${enc(slug)}/views`, {
				body,
				method: "POST",
			}),

		updateView: (viewId: string, body: Partial<View>) =>
			send<View>(target, `/views/${enc(viewId)}`, { body, method: "PATCH" }),

		deleteView: (viewId: string) =>
			send<void>(target, `/views/${enc(viewId)}`, { method: "DELETE" }),

		setDefaultView: (viewId: string) =>
			send<View>(target, `/views/${enc(viewId)}/default`, { method: "POST" }),

		/** Run a saved view server-side, so the board and the grid agree on what
		 *  the view MEANS without either re-deriving its filter locally. */
		runView: (
			viewId: string,
			overrides?: Partial<RecordQuery>,
			signal?: AbortSignal
		) =>
			send<Page<CrmRecord>>(target, `/views/${enc(viewId)}/run`, {
				body: overrides ?? {},
				method: "POST",
				signal,
			}),

		createList: (body: Partial<CrmList>) =>
			send<CrmList>(target, "/lists", { body, method: "POST" }),

		queryListEntries: (
			listId: string,
			query?: RecordQuery,
			signal?: AbortSignal
		) =>
			send<Page<ListEntry>>(target, `/lists/${enc(listId)}/entries/query`, {
				body: query ?? {},
				method: "POST",
				signal,
			}),

		addListEntry: (listId: string, recordId: string) =>
			send<ListEntry>(target, `/lists/${enc(listId)}/entries`, {
				body: { record_id: recordId },
				method: "POST",
			}),

		updateListEntry: (entryId: string, values: ValueBag) =>
			send<ListEntry>(target, `/list-entries/${enc(entryId)}`, {
				body: { values },
				method: "PATCH",
			}),

		// ── Timeline ─────────────────────────────────────────────────────────
		getTimeline: (recordId: string, limit?: number, signal?: AbortSignal) =>
			send<Page<Activity>>(
				target,
				`/records/${enc(recordId)}/activities${limit ? `?limit=${limit}` : ""}`,
				{ signal }
			),

		logActivity: (body: {
			assignee?: string;
			body?: string;
			due_at?: string;
			kind: ActivityKind;
			record_id?: string;
			title: string;
		}) => send<Activity>(target, "/activities", { body, method: "POST" }),

		completeActivity: (activityId: string, completed: boolean) =>
			send<Activity>(target, `/activities/${enc(activityId)}/complete`, {
				body: { completed },
				method: "POST",
			}),

		deleteActivity: (activityId: string) =>
			send<void>(target, `/activities/${enc(activityId)}`, {
				method: "DELETE",
			}),

		/** The cross-object task inbox. The window (overdue / today / upcoming) is
		 *  bucketed by the SERVER against the offset sent here, so the panel never
		 *  does date maths of its own and two clients in different zones agree. */
		getTasks: (
			params?: {
				assignee?: string;
				limit?: number;
				window?: "overdue" | "today" | "upcoming";
			},
			signal?: AbortSignal
		) => {
			const search = new URLSearchParams();
			if (params?.window) {
				search.set("window", params.window);
			}
			if (params?.assignee) {
				search.set("assignee", params.assignee);
			}
			if (params?.limit) {
				search.set("limit", String(params.limit));
			}
			search.set("utc_offset_minutes", String(-new Date().getTimezoneOffset()));
			return send<Page<Activity>>(target, `/tasks?${search.toString()}`, {
				signal,
			});
		},

		// ── Import / export ──────────────────────────────────────────────────
		/** Upload raw CSV text. The sidecar persists the bytes with the job so
		 *  preview and apply are two requests over the SAME file, not two uploads. */
		createImport: (slug: string, csv: string, filename?: string) =>
			send<ImportJob>(
				target,
				`/imports?object=${enc(slug)}${
					filename ? `&filename=${enc(filename)}` : ""
				}`,
				{ method: "POST", raw: csv }
			),

		getImport: (importId: string) =>
			send<ImportJob>(target, `/imports/${enc(importId)}`),

		setImportMapping: (
			importId: string,
			body: {
				dedupe?: { match_field_ids: string[]; strategy?: string };
				mappings: ImportMapping[];
			}
		) =>
			send<ImportJob>(target, `/imports/${enc(importId)}/mapping`, {
				body,
				method: "PUT",
			}),

		/** The dry run. Nothing is written; the counts are exact for the whole file
		 *  even when the per-row sample list is truncated. */
		previewImport: (importId: string) =>
			send<ImportPreview>(target, `/imports/${enc(importId)}/preview`, {
				method: "POST",
			}),

		/** Idempotent per job — applying twice does not double-create. */
		applyImport: (importId: string) =>
			send<ImportResult>(target, `/imports/${enc(importId)}/apply`, {
				method: "POST",
			}),

		deleteImport: (importId: string) =>
			send<void>(target, `/imports/${enc(importId)}`, { method: "DELETE" }),

		/** CSV of a view's current result set. Raw text, not JSON. */
		exportView: async (viewId: string): Promise<string> => {
			const response = await fetch(
				apiUrl(target, `${CRM_BASE}/exports/views/${enc(viewId)}`),
				{ headers: makeHeaders(target.token) }
			);
			if (!response.ok) {
				throw new CrmError(response.status, response.statusText);
			}
			return await response.text();
		},

		// ── Search & reports ─────────────────────────────────────────────────
		search: (query: string, object?: string, signal?: AbortSignal) => {
			const params = new URLSearchParams({ q: query });
			if (object) {
				params.set("object", object);
			}
			return send<{ hits: SearchHit[] }>(
				target,
				`/search?${params.toString()}`,
				{ signal }
			);
		},

		getSummary: (signal?: AbortSignal) =>
			send<CrmSummary>(target, "/summary", { signal }),

		getPipeline: (
			body?: {
				field_id?: string;
				include_closed?: boolean;
				object_id?: string;
				value_field_id?: string;
			},
			signal?: AbortSignal
		) =>
			send<PipelineReport>(target, "/reports/pipeline", {
				body: body ?? {},
				method: "POST",
				signal,
			}),
	};
}

export type CrmClient = ReturnType<typeof createCrmClient>;

export interface RelatedGroup {
	field_id: string;
	field_name: string;
	object_slug: string;
	records: CrmRecord[];
}

export interface DuplicateGroup {
	field_id: string;
	records: CrmRecord[];
}

export interface CrmSummary {
	open_tasks: number;
	overdue_tasks: number;
	recent_activity: Activity[];
	total_records: number;
}
