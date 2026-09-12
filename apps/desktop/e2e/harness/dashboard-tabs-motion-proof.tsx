import { cn } from "@ryu/ui/lib/utils.ts";
import {
	type CSSProperties,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import { DashboardGrid } from "@/src/components/dashboard/DashboardGrid.tsx";
import { SplitDropZones } from "@/src/components/layout/SplitDropZones.tsx";
import {
	computeSplitLayout,
	type PaneRect,
	paneRectPx,
} from "@/src/components/layout/SplitView.tsx";
import {
	TabDndProvider,
	useTabDnd,
	useTabDragProps,
} from "@/src/components/layout/tabDnd.tsx";
import type { Split, Tab } from "@/src/contexts/TabsContext.tsx";
import { TabsContext } from "@/src/contexts/TabsContext.tsx";
import type { Widget } from "@/src/lib/api/dashboard.ts";
import {
	directionBefore,
	directionOrientation,
	makeBranch,
	makeLeaf,
	type SplitDirection,
} from "@/src/lib/splitTree.ts";
import "../../src/index.css";

const WIDGETS: Widget[] = [
	{
		config: { delta_key: "delta", label: "Tasks closed", unit: "/wk" },
		dashboard_id: "motion-proof",
		id: "throughput",
		kind: "stat",
		last_value: { delta: 12, value: 128 },
		layout: { h: 3, w: 3, x: 0, y: 0 },
		source: { type: "static", data: null },
		title: "Throughput",
	},
	{
		config: { label_key: "label" },
		dashboard_id: "motion-proof",
		id: "focus",
		kind: "list",
		last_value: [
			{ label: "Review the open pull request" },
			{ label: "Prepare the customer handoff" },
			{ label: "Update the runbook" },
		],
		layout: { h: 4, w: 5, x: 3, y: 0 },
		source: { type: "static", data: null },
		title: "Next up",
	},
	{
		config: {
			markdown:
				"A calm board with just enough movement to make each change legible.",
		},
		dashboard_id: "motion-proof",
		id: "note",
		kind: "text",
		last_value: null,
		layout: { h: 3, w: 4, x: 8, y: 0 },
		source: { type: "static", data: null },
		title: "Workspace note",
	},
];

const INITIAL_TABS: Tab[] = [
	{ id: "tab-a", path: "/chat", title: "Research" },
	{ id: "tab-b", path: "/library", title: "Library" },
];

function DraggableTab({ tab }: { tab: Tab }) {
	const dnd = useTabDnd();
	const { dragHandlers } = useTabDragProps(tab.id);
	return (
		<button
			{...dragHandlers}
			className={cn(
				"rounded-full border px-3 py-1.5 font-medium text-xs transition-[opacity,transform,box-shadow] duration-150",
				dnd.draggingId === tab.id
					? "scale-[0.97] opacity-40 shadow-lg"
					: "bg-card hover:bg-muted"
			)}
			data-testid={`drag-${tab.id}`}
			type="button"
		>
			{tab.title}
		</button>
	);
}

function DemoPane({ tab, style }: { tab: Tab; style: CSSProperties }) {
	return (
		<section
			className="absolute overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm transition-[left,top,width,height] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
			data-testid={`pane-tab-${tab.id.slice(-1)}`}
			style={style}
		>
			<div className="flex h-12 items-center gap-2 border-b bg-muted/30 px-4">
				<span className="size-2 rounded-full bg-primary" />
				<span className="font-medium text-sm">{tab.title}</span>
			</div>
			<div className="p-4 text-muted-foreground text-sm">
				{tab.id === "tab-a"
					? "Drag this tab onto the edge of the other pane."
					: "The target pane becomes a split without losing its place."}
			</div>
		</section>
	);
}

function splitPaneStyle(
	rect: PaneRect,
	container: { height: number; width: number }
): CSSProperties {
	const px = paneRectPx(rect, container);
	return {
		height: `calc(${(rect.height.frac * 100).toFixed(4)}% - ${rect.top.frac === 0 ? 48 : 0}px)`,
		left: `${rect.left.frac * 100}%`,
		top: `calc(${rect.top.frac * 100}% + ${rect.top.frac === 0 ? 48 : 0}px)`,
		width: `${rect.width.frac * 100}%`,
		zIndex: 1,
		// Keep the helper's pixel calculation live in the proof so the same
		// pane geometry used by SplitDropZones is exercised.
		"--proof-pane-width": `${px.width}px`,
	};
}

function SplitMotionSurface({
	status,
	splits,
	surfaceRef,
	tabs,
}: {
	status: string;
	splits: Split[];
	surfaceRef: { current: HTMLDivElement | null };
	tabs: Tab[];
}) {
	const dnd = useTabDnd();
	const layout = splits[0] ? computeSplitLayout(splits[0].root) : null;
	const size = surfaceRef.current?.getBoundingClientRect();
	const container = size
		? { height: size.height, width: size.width }
		: { height: 360, width: 800 };

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				{tabs.map((tab) => (
					<DraggableTab key={tab.id} tab={tab} />
				))}
				<span
					className="ml-auto text-muted-foreground text-xs"
					data-testid="dnd-state"
				>
					{dnd.draggingId
						? `Dragging ${tabs.find((tab) => tab.id === dnd.draggingId)?.title}`
						: "Ready"}
				</span>
			</div>
			<div
				className="relative h-[360px] overflow-hidden rounded-2xl border border-border/70 bg-muted/10"
				data-testid="split-demo-surface"
				ref={surfaceRef}
			>
				{layout ? (
					tabs
						.filter((tab) => layout.panes.has(tab.id))
						.map((tab) => (
							<DemoPane
								key={tab.id}
								style={splitPaneStyle(layout.panes.get(tab.id)!, container)}
								tab={tab}
							/>
						))
				) : (
					<DemoPane
						style={{
							height: "calc(100% - 48px)",
							left: 0,
							top: 48,
							width: "100%",
							zIndex: 1,
						}}
						tab={tabs[1]}
					/>
				)}
				<SplitDropZones containerRef={surfaceRef} />
			</div>
			<p className="text-muted-foreground text-xs" data-testid="split-status">
				{status}
			</p>
		</div>
	);
}

function SplitMotionDemo() {
	const [tabs, setTabs] = useState(INITIAL_TABS);
	const [splits, setSplits] = useState<Split[]>([]);
	const [activeTabId, setActiveTabId] = useState("tab-b");
	const [status, setStatus] = useState("One pane");
	const surfaceRef = useRef<HTMLDivElement>(null);

	const splitPane = useCallback(
		(sourceTabId: string, targetTabId: string, direction: SplitDirection) => {
			const splitId = "proof-split";
			const sourceFirst = directionBefore(direction);
			const root = makeBranch(
				directionOrientation(direction),
				sourceFirst
					? [makeLeaf(sourceTabId), makeLeaf(targetTabId)]
					: [makeLeaf(targetTabId), makeLeaf(sourceTabId)]
			);
			setTabs((current) =>
				current.map((tab) =>
					tab.id === sourceTabId || tab.id === targetTabId
						? { ...tab, splitId }
						: tab
				)
			);
			setSplits([
				{ collapsed: false, color: "blue", id: splitId, name: "Review", root },
			]);
			setActiveTabId(sourceTabId);
			setStatus("Two panes");
		},
		[]
	);

	const contextValue = useMemo(
		() =>
			({
				activeTabId,
				moveTab: () => undefined,
				removeFromSplit: () => undefined,
				splitPane,
				splits,
				swapSplitPanes: () => undefined,
				tabs,
			}) as never,
		[activeTabId, splitPane, splits, tabs]
	);

	return (
		<TabsContext.Provider value={contextValue}>
			<TabDndProvider>
				<SplitMotionSurface
					splits={splits}
					status={status}
					surfaceRef={surfaceRef}
					tabs={tabs}
				/>
			</TabDndProvider>
		</TabsContext.Provider>
	);
}

function ProofApp() {
	const [saved, setSaved] = useState(
		"Drag a dashboard card or tab to feel the settle."
	);
	return (
		<div className="min-h-screen bg-background p-6 text-foreground">
			<style>
				{"html, body { overflow: auto !important; height: auto !important; }"}
			</style>
			<div className="mx-auto flex max-w-6xl flex-col gap-6">
				<header>
					<p className="font-medium text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
						Ryu interaction proof
					</p>
					<h1 className="mt-1 font-semibold text-2xl tracking-tight">
						Dashboard + tab splitting
					</h1>
					<p className="mt-2 max-w-2xl text-muted-foreground text-sm">
						Spatial feedback for drag gestures: the card lifts, the target
						previews, and a new split settles into place.
					</p>
				</header>
				<section
					className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm"
					data-testid="dashboard-motion-proof"
				>
					<div className="mb-3 flex items-center justify-between">
						<div>
							<h2 className="font-medium text-sm">Work dashboard</h2>
							<p className="text-muted-foreground text-xs">
								Drag from a widget header; the placeholder marks the landing
								slot.
							</p>
						</div>
						<span
							className="text-muted-foreground text-xs"
							data-testid="dashboard-save-status"
						>
							{saved}
						</span>
					</div>
					<div className="h-[340px]">
						<DashboardGrid
							live={{}}
							onLayoutPersist={() => setSaved("Layout saved")}
							onRefresh={() => undefined}
							onRemove={() => undefined}
							widgets={WIDGETS}
						/>
					</div>
				</section>
				<section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
					<div className="mb-3">
						<h2 className="font-medium text-sm">Split drop target</h2>
						<p className="text-muted-foreground text-xs">
							Drag Research onto the right edge of Library.
						</p>
					</div>
					<SplitMotionDemo />
				</section>
			</div>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(<ProofApp />);
