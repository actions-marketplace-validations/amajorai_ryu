// apps/desktop/src/components/library/ContributedLibrarySection.tsx
//
// An app-registered collection rendered inside the Library, from the SAME
// `contributes.sidebar_sections` declaration the sidebar reads.
//
// Why the sidebar contribution and not a new `library_sections` family: an app
// that declares "here is my collection, here is where its rows live, here is the
// route a row opens" has already said everything the Library needs. Asking it to
// say it a second time in a second vocabulary would mean an app could ship a
// sidebar section and a Library tab that disagree — and the sidebar list is the
// one that keeps growing, which is exactly the pile-up the Library exists to
// absorb. One declaration, two surfaces.
//
// Rows come from `spec.source` (a Core `/api/` path fetched through the
// authenticated node seam, mapped by `sourceItemsFromResponse`) and a click opens
// `spec.itemTarget`, the same `{{item.<key>}}` route template the sidebar honours.
// Nothing here is per-app.

import { GridIcon } from "@hugeicons/core-free-icons";
import {
	isCoreApiPath,
	renderTemplate,
	type SourceItem,
	sourceItemsFromResponse,
} from "@ryu/app-host/views";
import {
	LibraryCard,
	LibraryEmpty,
	LibraryGrid,
	LibraryLoading,
} from "@ryu/blocks/desktop/library";
import type { ViewMode } from "@ryu/blocks/desktop/view-toggle";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { parseContributedTarget } from "@/src/contributions/contributed-target.ts";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { apiUrl, makeHeaders, toTarget } from "@/src/lib/api/client.ts";
import type { PluginSidebarSection } from "@/src/lib/api/plugins.ts";

/** Poll floor, mirroring the sidebar's: a typo'd `refreshMs` must not turn the
 *  Library into a request loop. */
const MIN_REFRESH_MS = 1000;

export default function ContributedLibrarySection({
	section,
	query,
	view,
}: {
	query: string;
	section: PluginSidebarSection;
	view: ViewMode;
}) {
	const node = useActiveNode();
	const { openTab } = useTabsContext();
	const spec = section.spec;
	const source = spec?.source;
	const path = source?.http.path;
	const method = source?.http.method ?? "GET";
	const target = toTarget(node);
	const fetchable = Boolean(source && path && isCoreApiPath(path));

	const { data: payload, isLoading } = useQuery({
		// Same key shape the sidebar uses, so a section shown in both places shares
		// one request and one poll rather than doubling them.
		queryKey: [
			"contributed-section-source",
			target.url,
			target.token,
			path ?? "",
			method,
		],
		enabled: fetchable,
		retry: false,
		queryFn: async () => {
			const resp = await fetch(apiUrl(target, path as string), {
				method,
				headers: makeHeaders(target.token),
			});
			return resp.ok ? ((await resp.json()) as unknown) : null;
		},
		refetchInterval: source?.refreshMs
			? Math.max(source.refreshMs, MIN_REFRESH_MS)
			: false,
	});

	const rows: SourceItem[] = useMemo(
		() => (source && payload ? sourceItemsFromResponse(source, payload) : []),
		[source, payload]
	);

	const visible = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) {
			return rows;
		}
		return rows.filter((row) =>
			[row.item.title, row.item.subtitle, row.item.accessory]
				.filter(Boolean)
				.join(" ")
				.toLowerCase()
				.includes(q)
		);
	}, [rows, query]);

	const open = (row: SourceItem) => {
		if (!spec?.itemTarget) {
			return;
		}
		const { path: route, options } = parseContributedTarget(
			renderTemplate(spec.itemTarget, { item: row.raw }, { uriEncode: true })
		);
		openTab(route, { ...options, title: row.item.title });
	};

	if (isLoading && rows.length === 0) {
		return <LibraryLoading />;
	}

	if (visible.length === 0) {
		return (
			<LibraryEmpty
				description={
					query
						? "Nothing matches your search."
						: (spec?.emptyState?.description ??
							`${section.title} has nothing in it yet.`)
				}
				icon={GridIcon}
				title={
					query ? "No results" : (spec?.emptyState?.title ?? "Nothing yet")
				}
			/>
		);
	}

	return (
		<LibraryGrid columns={2} view={view}>
			{visible.map((row) => (
				<LibraryCard
					item={{
						key: row.item.id,
						icon: GridIcon,
						name: row.item.title,
						subtitle: row.item.subtitle ?? null,
						badge: row.item.accessory ?? null,
						// Favouriting is keyed by `{type,id}` over the Library's own item
						// types; a contributed row has no such type, so the star is
						// deliberately absent rather than a control that saves nowhere.
						favorited: false,
					}}
					key={row.item.id}
					onOpen={() => open(row)}
					view={view}
				/>
			))}
		</LibraryGrid>
	);
}
