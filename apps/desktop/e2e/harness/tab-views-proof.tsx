import { useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { InfiniteTabsCanvas } from "../../src/components/layout/InfiniteTabsCanvas.tsx";
import { ScrollableTabsView as ScrollView } from "../../src/components/layout/ScrollableTabsView.tsx";
import {
	type Split,
	type Tab,
	type TabGroup,
	TabsContext,
	type TabsContextValue,
} from "../../src/contexts/TabsContext.tsx";
import type { RouteTab } from "../../src/contributions/registry.ts";
import { contributionRegistry } from "../../src/contributions/registry.ts";
import { setTabLayout, useTabLayout } from "../../src/hooks/useTabLayout.ts";
import "../../src/index.css";

const TAB_LAYOUT_KEY = "ryu_tab_layout";
const TAB_CANVAS_KEY = "ryu:tab-canvas-layout:v1";

localStorage.removeItem(TAB_LAYOUT_KEY);
localStorage.removeItem(TAB_CANVAS_KEY);
setTabLayout("scroll");

const GROUPS: TabGroup[] = [
	{ collapsed: false, color: "blue", id: "group-research", name: "Research" },
];

const SPLITS: Split[] = [
	{
		collapsed: false,
		color: "green",
		id: "split-output",
		name: "Output pair",
		root: {
			children: [
				{ tabId: "tab-four", type: "leaf" },
				{ tabId: "tab-five", type: "leaf" },
			],
			orientation: "columns",
			sizes: [0.5, 0.5],
			type: "branch",
		},
	},
];

const INITIAL_TABS: Tab[] = [
	{ id: "tab-one", path: "/tab-proof/one", title: "Overview" },
	{
		groupId: "group-research",
		id: "tab-two",
		path: "/tab-proof/two",
		title: "Research notes",
	},
	{
		groupId: "group-research",
		id: "tab-three",
		path: "/tab-proof/three",
		title: "Open questions",
	},
	{
		id: "tab-four",
		path: "/tab-proof/four",
		splitId: "split-output",
		title: "Draft output",
	},
	{
		id: "tab-five",
		path: "/tab-proof/five",
		splitId: "split-output",
		title: "Review output",
	},
];

contributionRegistry.registerRoute({
	kind: "pattern",
	test: { startsWith: "/tab-proof/" },
	render: (tab: RouteTab) => (
		<div className="flex h-full flex-col gap-4 overflow-auto bg-muted/20 p-6">
			<p className="font-medium text-[10px] text-muted-foreground uppercase tracking-[0.16em]">
				Live route host
			</p>
			<h2 className="font-semibold text-2xl text-foreground">{tab.path}</h2>
			<p className="max-w-lg text-muted-foreground text-sm leading-6">
				This proof page is mounted through the real RouteOutlet boundary. The
				card or canvas node can move and focus without replacing the route host.
			</p>
			<div
				className="mt-auto rounded-xl border border-border/70 bg-card p-4 text-muted-foreground text-xs"
				data-proof-route={tab.path}
			>
				Rendered live for{" "}
				<strong className="text-foreground">{tab.path}</strong>
			</div>
		</div>
	),
});

function Story() {
	const [tabs, setTabs] = useState(INITIAL_TABS);
	const [activeTabId, setActiveTabId] = useState(INITIAL_TABS[0].id);
	const nextTabNumber = useRef(6);
	const tabLayout = useTabLayout();

	const focusTab = useCallback((id: string) => {
		setActiveTabId(id);
	}, []);
	const closeTab = useCallback((id: string) => {
		setTabs((current) => {
			const next = current.filter((tab) => tab.id !== id);
			setActiveTabId((active) =>
				active === id ? (next[0]?.id ?? "") : active
			);
			return next;
		});
	}, []);
	const openTab = useCallback((path: string) => {
		const number = nextTabNumber.current;
		nextTabNumber.current += 1;
		const id = `tab-new-${number}`;
		const tab: Tab = { id, path, title: `New tab ${number}` };
		setTabs((current) => [...current, tab]);
		setActiveTabId(id);
		return id;
	}, []);

	const contextValue = useMemo(
		() =>
			({
				activeTabId,
				closeTab,
				focusTab,
				groups: GROUPS,
				openTab,
				splits: SPLITS,
				tabs,
			}) as unknown as TabsContextValue,
		[activeTabId, closeTab, focusTab, openTab, tabs]
	);

	return (
		<TabsContext.Provider value={contextValue}>
			<main className="min-h-screen bg-background text-foreground">
				<header className="flex flex-wrap items-center justify-between gap-4 border-border/70 border-b px-6 py-4">
					<div>
						<p className="font-medium text-[10px] text-muted-foreground uppercase tracking-[0.16em]">
							Desktop tab view proof
						</p>
						<h1 className="mt-1 font-semibold text-xl">Live panes, two ways</h1>
					</div>
					<div className="flex items-center gap-2">
						<button
							className="rounded-lg border border-border/70 px-3 py-2 font-medium text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							data-testid="show-scroll-view"
							onClick={() => setTabLayout("scroll")}
							type="button"
						>
							Scrollable tabs
						</button>
						<button
							className="rounded-lg bg-primary px-3 py-2 font-medium text-primary-foreground text-xs transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							data-testid="show-canvas-view"
							onClick={() => setTabLayout("canvas")}
							type="button"
						>
							Infinite canvas
						</button>
					</div>
				</header>
				<div className="border-border/70 border-b px-6 py-2 text-muted-foreground text-xs">
					Mode:{" "}
					<strong className="text-foreground" data-testid="mode">
						{tabLayout}
					</strong>{" "}
					· Active tab:{" "}
					<strong className="text-foreground" data-testid="active-tab">
						{activeTabId}
					</strong>
				</div>
				<div className="h-[calc(100vh-105px)] min-h-[620px]">
					{tabLayout === "canvas" ? <InfiniteTabsCanvas /> : <ScrollView />}
				</div>
			</main>
		</TabsContext.Provider>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
