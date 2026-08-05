import { describe, expect, it } from "bun:test";
import {
	groupStoreItems,
	helloListDetail,
	helloListDetailContribution,
	isCoreApiPath,
	isKnownViewKind,
	renderActionHttp,
	renderTemplate,
	type StoreCatalogItem,
	type StoreTabSpec,
	sourceItemsFromResponse,
	storeItemHaystack,
	storeItemsFromResponse,
	VIEW_KINDS,
	type ViewSource,
	type ViewSpec,
	validateView,
} from "./views.ts";

describe("declarative view vocabulary", () => {
	it("exposes exactly the seven standardized kinds", () => {
		expect([...VIEW_KINDS]).toEqual([
			"list-detail",
			"data-table",
			"form",
			"action-panel",
			"filter-bar",
			"empty-state",
			"stat-card-row",
		]);
	});

	it("recognizes known kinds and rejects unknown ones", () => {
		for (const kind of VIEW_KINDS) {
			expect(isKnownViewKind(kind)).toBe(true);
		}
		expect(isKnownViewKind("gantt-chart")).toBe(false);
		expect(isKnownViewKind(42)).toBe(false);
	});

	it("validates the hello list-detail example spec", () => {
		const result = validateView(helloListDetail);
		expect(result.ok).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it("carries the example as a wire ViewContribution", () => {
		expect(helloListDetailContribution.id).toBe("hello");
		expect(helloListDetailContribution.view).toBe("list-detail");
		expect(helloListDetailContribution.spec).toBe(helloListDetail);
		// The example is non-trivial: three rows, one with a success badge.
		expect(helloListDetail.items).toHaveLength(3);
		expect(helloListDetail.items[0]?.badges?.[0]?.tone).toBe("success");
	});

	it("flags an unknown view kind instead of throwing", () => {
		const result = validateView({ view: "hologram", items: [] });
		expect(result.ok).toBe(false);
		expect(result.errors[0]).toContain("unknown view kind");
	});

	it("requires the collection each kind depends on", () => {
		const cases: [ViewSpec["view"], Record<string, unknown>, string][] = [
			["list-detail", {}, "items"],
			["data-table", { columns: [] }, "rows"],
			["form", {}, "fields"],
			["action-panel", {}, "actions"],
			["filter-bar", {}, "filters"],
			["stat-card-row", {}, "stats"],
		];
		for (const [view, extra, missing] of cases) {
			const result = validateView({ view, ...extra });
			expect(result.ok).toBe(false);
			expect(result.errors.join(" ")).toContain(missing);
		}
	});

	it("requires a title for empty-state", () => {
		expect(validateView({ view: "empty-state", title: "Nothing" }).ok).toBe(
			true
		);
		expect(validateView({ view: "empty-state" }).ok).toBe(false);
	});

	it("rejects non-object specs", () => {
		expect(validateView(null).ok).toBe(false);
		expect(validateView("list-detail").ok).toBe(false);
	});

	it("stays backward-shallow: unknown fields and new action fields pass", () => {
		const result = validateView({
			view: "list-detail",
			items: [],
			source: { http: { path: "/api/quests" }, items: "quests" },
			itemActions: [
				{
					id: "complete",
					label: "Complete",
					confirm: "Sure?",
					payload: { reason: "manual" },
					http: { method: "POST", path: "/api/quests/{{item.id}}/complete" },
				},
			],
			someFutureField: { anything: true },
		});
		expect(result.ok).toBe(true);
		expect(result.errors).toEqual([]);
	});
});

describe("action templating", () => {
	it("interpolates form values and item keys", () => {
		const ctx = {
			values: { name: "Ada", count: 2 },
			item: { id: "q-1", status: "open" },
		};
		expect(renderTemplate("hello {{name}} x{{count}}", ctx)).toBe(
			"hello Ada x2"
		);
		expect(renderTemplate("/api/quests/{{item.id}}/complete", ctx)).toBe(
			"/api/quests/q-1/complete"
		);
		expect(renderTemplate("{{missing}}", ctx)).toBe("");
	});

	it("uri-encodes substituted path segments", () => {
		expect(
			renderTemplate(
				"/api/quests/{{item.id}}",
				{ item: { id: "a/b c" } },
				{ uriEncode: true }
			)
		).toBe("/api/quests/a%2Fb%20c");
	});

	it("renders a declarative http action with a type-preserving body", () => {
		const rendered = renderActionHttp(
			{
				method: "POST",
				path: "/api/quests/{{item.id}}/complete",
				body: {
					title: "{{title}}",
					done: "{{done}}",
					note: "quest {{item.id}}",
				},
			},
			{
				values: { title: "Ship it", done: true },
				item: { id: "q-9" },
			}
		);
		expect(rendered.method).toBe("POST");
		expect(rendered.path).toBe("/api/quests/q-9/complete");
		expect(rendered.body).toEqual({
			title: "Ship it",
			done: true,
			note: "quest q-9",
		});
	});

	it("refuses non-core paths (including templated escapes)", () => {
		expect(isCoreApiPath("/api/quests")).toBe(true);
		expect(isCoreApiPath("/etc/passwd")).toBe(false);
		expect(isCoreApiPath("https://evil.example/api/")).toBe(false);
		expect(isCoreApiPath("/api/../admin")).toBe(false);
		expect(() =>
			renderActionHttp(
				{ method: "GET", path: "{{item.url}}" },
				{ item: { url: "https://evil.example/" } }
			)
		).toThrow();
	});
});

describe("source-fetched items", () => {
	const source: ViewSource = {
		http: { path: "/api/quests" },
		items: "quests",
		map: { subtitle: "detail", accessory: "status" },
	};

	it("maps response rows to items and keeps the raw row", () => {
		const items = sourceItemsFromResponse(source, {
			quests: [
				{ id: "q-1", title: "Write docs", detail: "for views", status: "open" },
				{ id: "q-2", title: "Ship it", status: "open" },
			],
		});
		expect(items).toHaveLength(2);
		expect(items[0]?.item).toEqual({
			id: "q-1",
			title: "Write docs",
			subtitle: "for views",
			detail: undefined,
			accessory: "open",
		});
		expect(items[0]?.raw.status).toBe("open");
		expect(items[1]?.item.subtitle).toBeUndefined();
	});

	it("degrades bad payloads and rows to empty/skipped, never throws", () => {
		expect(sourceItemsFromResponse(source, null)).toEqual([]);
		expect(sourceItemsFromResponse(source, { quests: "nope" })).toEqual([]);
		expect(
			sourceItemsFromResponse(source, { quests: [{ title: "no id" }, 42] })
		).toEqual([]);
		// Bare-array payload + default id/title map.
		expect(
			sourceItemsFromResponse({ http: { path: "/api/x" } }, [
				{ id: 1, title: "One" },
			])
		).toHaveLength(1);
	});

	// One endpoint, several sections: `/api/runs` takes no query parameters, so a
	// status slice has to happen client-side or Working and Done show the same rows.
	const runs = {
		runs: [
			{ id: "r-1", title: "A", run_status: "running", folder_path: "/w/alpha" },
			{
				id: "r-2",
				title: "B",
				run_status: "completed",
				folder_path: "/w/beta",
			},
			{ id: "r-3", title: "C", run_status: "failed", folder_path: "/w/beta/" },
			{ id: "r-4", title: "D" },
		],
	};

	it("filters rows by equals / in / notIn, ANDing every predicate", () => {
		const slice = (filter: ViewSource["filter"]) =>
			sourceItemsFromResponse(
				{ http: { path: "/api/runs" }, items: "runs", filter },
				runs
			).map((entry) => entry.item.id);

		expect(slice([{ key: "run_status", equals: "running" }])).toEqual(["r-1"]);
		expect(slice([{ key: "run_status", in: ["completed", "failed"] }])).toEqual(
			["r-2", "r-3"]
		);
		expect(slice([{ key: "run_status", notIn: ["running"] }])).toEqual([
			"r-2",
			"r-3",
		]);
		expect(
			slice([
				{ key: "run_status", notIn: ["running"] },
				{ key: "folder_path", equals: "/w/beta" },
			])
		).toEqual(["r-2"]);
		// A key the row lacks never matches — r-4 has no run_status.
		expect(slice([{ key: "run_status" }])).toEqual(["r-1", "r-2", "r-3"]);
	});

	it("caps rows at `limit`, counting only rows that survived the filter", () => {
		expect(
			sourceItemsFromResponse(
				{
					http: { path: "/api/runs" },
					items: "runs",
					filter: [{ key: "run_status", notIn: ["running"] }],
					limit: 1,
				},
				runs
			).map((entry) => entry.item.id)
		).toEqual(["r-2"]);
	});

	it("transforms a subtitle to its basename and falls back for a missing title", () => {
		const items = sourceItemsFromResponse(
			{
				http: { path: "/api/runs" },
				items: "runs",
				map: {
					subtitle: "folder_path",
					subtitleTransform: "basename",
					titleFallback: "Untitled run",
				},
			},
			{
				runs: [
					{ id: "r-1", title: "A", folder_path: "/w/alpha" },
					// A trailing separator must not yield an empty second line.
					{ id: "r-2", title: "B", folder_path: "C:\\work\\beta\\" },
					// A run Core has not titled yet stays listed, under the fallback.
					{ id: "r-3", folder_path: "/w/gamma" },
					// No folder at all = no second line (the row stays single-line).
					{ id: "r-4", title: "D" },
				],
			}
		);
		expect(items.map((entry) => entry.item.subtitle)).toEqual([
			"alpha",
			"beta",
			"gamma",
			undefined,
		]);
		expect(items[2]?.item.title).toBe("Untitled run");
	});
});

// ── Store-tab catalog primitives (contributes.store_tabs) ────────────────────

describe("storeItemsFromResponse", () => {
	const spec: StoreTabSpec = {
		source: { http: { path: "/api/meetings/templates" }, items: "templates" },
		map: { tags: "tags", installed: "active", icon: "icon" },
		groupBy: "category",
	};

	it("maps catalog rows, defaulting title to `name`", () => {
		const items = storeItemsFromResponse(spec, {
			templates: [
				{
					id: "standup",
					name: "Daily standup",
					description: "Per-person progress",
					category: "recurring",
					icon: "lucide:repeat",
					tags: ["standup", "scrum"],
					active: true,
				},
			],
		});
		expect(items).toHaveLength(1);
		expect(items[0]?.title).toBe("Daily standup");
		expect(items[0]?.installed).toBe(true);
		expect(items[0]?.group).toBe("recurring");
		expect(items[0]?.tags).toEqual(["standup", "scrum"]);
		// The RAW row is preserved as the `{{item.<key>}}` templating base.
		expect(items[0]?.raw.category).toBe("recurring");
	});

	it("treats a row as not-installed when the spec maps no such flag", () => {
		const items = storeItemsFromResponse(
			{ source: { http: { path: "/api/x" } } },
			[{ id: "a", name: "A", active: true }]
		);
		expect(items[0]?.installed).toBe(false);
	});

	it("degrades a bad payload to empty and skips unusable rows", () => {
		expect(storeItemsFromResponse(spec, null)).toEqual([]);
		expect(storeItemsFromResponse(spec, { templates: "nope" })).toEqual([]);
		expect(
			storeItemsFromResponse(spec, { templates: [{ name: "no id" }, 42] })
		).toEqual([]);
	});
});

describe("groupStoreItems", () => {
	const spec: StoreTabSpec = {
		groupBy: "category",
		groups: [
			{ value: "recurring", label: "Team rituals" },
			{ value: "revenue", label: "Sales & customers" },
		],
	};
	const rows = (...categories: string[]) =>
		storeItemsFromResponse(
			{ ...spec, source: { http: { path: "/api/x" } } },
			categories.map((category, i) => ({
				id: `id-${i}`,
				name: `Row ${i}`,
				category,
			}))
		);

	it("orders groups as declared and drops empty ones", () => {
		const groups = groupStoreItems(spec, rows("revenue", "recurring"));
		expect(groups.map((g) => g.label)).toEqual([
			"Team rituals",
			"Sales & customers",
		]);
	});

	it("never drops a row whose category the manifest forgot to label", () => {
		const groups = groupStoreItems(spec, rows("recurring", "hiring"));
		expect(groups.map((g) => g.value)).toEqual(["recurring", "hiring"]);
		// The undeclared one is titled by its raw value rather than vanishing.
		expect(groups[1]?.label).toBe("hiring");
	});

	it("yields a single unlabelled group when the tab is ungrouped", () => {
		const ungrouped: StoreTabSpec = { source: { http: { path: "/api/x" } } };
		const items = storeItemsFromResponse(ungrouped, [{ id: "a", name: "A" }]);
		expect(groupStoreItems(ungrouped, items)).toEqual([
			{ items, label: "", value: "" },
		]);
		expect(groupStoreItems(ungrouped, [])).toEqual([]);
	});
});

describe("storeItemHaystack", () => {
	it("folds title, description, badge, tags and extra searchFields", () => {
		const spec: StoreTabSpec = {
			source: { http: { path: "/api/x" } },
			map: { badge: "pattern", tags: "tags" },
			searchFields: ["author"],
		};
		const [item] = storeItemsFromResponse(spec, [
			{
				id: "a",
				name: "Evaluator Optimizer",
				description: "Draft then critique",
				pattern: "evaluator-optimizer",
				tags: ["quality"],
				author: "Anthropic",
			},
		]);
		const hay = storeItemHaystack(spec, item as StoreCatalogItem);
		for (const needle of [
			"evaluator optimizer",
			"draft then critique",
			"evaluator-optimizer",
			"quality",
			"anthropic",
		]) {
			expect(hay).toContain(needle);
		}
	});
});
