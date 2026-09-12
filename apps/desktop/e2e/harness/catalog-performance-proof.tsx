import { Button } from "@ryu/ui/components/button.tsx";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppSurfaceProvider } from "@/src/contexts/app-surface-context.tsx";
import { EntitlementProvider } from "@/src/contexts/entitlement-context.tsx";
import { TabsProvider } from "@/src/contexts/TabsContext.tsx";
import { useAgents } from "@/src/hooks/useAgents.ts";
import { useApps } from "@/src/hooks/useApps.ts";
import { useSystemStatus } from "@/src/hooks/useSystemStatus.ts";
import { triggerGlobalRefresh } from "@/src/lib/core-refresh.ts";
import { queryClient } from "@/src/lib/query-client.ts";
import SpaceFileViewerPage from "@/src/pages/SpaceFileViewerPage.tsx";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import "../../src/index.css";

function selectNode(name: string) {
	useNodeStore.setState({
		nodes: [
			{
				name,
				url: `${location.origin}/proof-api/${name}`,
				token: null,
				userJwt: null,
			},
		],
		defaultNode: name,
		autoSelect: false,
	});
}
selectNode("alpha");
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
	const url = input instanceof Request ? input.url : String(input);
	if (url.includes("/api/preferences/")) {
		return Promise.resolve(Response.json({ value: "false" }));
	}
	return nativeFetch(input, init);
};
queryClient.setDefaultOptions({
	queries: { retry: false, refetchOnWindowFocus: false, gcTime: 30_000 },
});
function CatalogCard({ index }: { index: number }) {
	const roster = useAgents();
	const apps = useApps();
	return (
		<section
			className="rounded-xl border bg-card p-4"
			data-testid="catalog-card"
		>
			<h2 className="font-medium">
				{index === 0 ? "Agents and apps" : `Workspace ${index + 1}`}
			</h2>
			<p className="mt-2 text-muted-foreground text-xs">
				Shared data · independent mounted consumer
			</p>
			{roster.loading || apps.loading ? (
				<p>Loading catalogs…</p>
			) : (
				<>
					<p className="mt-4 text-sm" data-testid="agent-name">
						{roster.agents[0]?.name ?? "No agents"}
					</p>
					<p className="mt-1 text-sm" data-testid="app-state">
						{apps.apps[0]?.name}:{" "}
						{apps.apps[0]?.enabled ? "Enabled" : "Disabled"}
					</p>
				</>
			)}
			<p className="text-destructive text-xs" role="status">
				{roster.error ?? apps.error ?? apps.toggleError}
			</p>
			{index === 0 ? (
				<div className="mt-4 flex flex-wrap gap-2">
					<Button onClick={() => void roster.reload()} size="sm">
						Reload agents
					</Button>
					<Button
						onClick={() =>
							void roster.update("agent-1", {
								name: "Updated researcher",
								description: null,
								engine: null,
								systemPrompt: null,
								tools: [],
							})
						}
						size="sm"
					>
						Rename agent
					</Button>
					<Button
						onClick={() => void apps.toggle("app-1", !apps.apps[0]?.enabled)}
						size="sm"
					>
						Toggle app
					</Button>
				</div>
			) : null}
		</section>
	);
}
function LiveStatus() {
	const status = useSystemStatus();
	useQuery(
		{
			queryKey: ["proof-poll"],
			queryFn: () => fetch("/proof-poll").then((response) => response.json()),
			refetchInterval: 200,
			staleTime: 0,
			refetchOnWindowFocus: true,
		},
		queryClient
	);
	return (
		<span className="text-muted-foreground text-xs" data-testid="connection">
			{status.loading
				? "Connecting…"
				: status.coreReachable
					? "Core connected"
					: "Core unavailable"}
		</span>
	);
}
function Shell() {
	const [view, setView] = useState("catalog");
	const [count, setCount] = useState(8);
	const [requests, setRequests] = useState(0);
	useEffect(() => {
		const timer = setInterval(
			() =>
				void fetch("/proof-metrics")
					.then((response) => response.json())
					.then((value) => setRequests(value.catalogReads)),
			500
		);
		return () => clearInterval(timer);
	}, []);
	return (
		<main className="flex h-screen flex-col bg-background text-foreground">
			<header className="flex flex-wrap items-center gap-2 border-b p-4">
				<h1 className="mr-auto font-semibold">
					Ryu · Catalog and file loading
				</h1>
				<LiveStatus />
				<Button onClick={() => selectNode("alpha")} variant="outline">
					Node alpha
				</Button>
				<Button onClick={() => selectNode("beta")} variant="outline">
					Node beta
				</Button>
			</header>
			<nav className="flex flex-wrap gap-2 border-b p-3">
				<Button
					onClick={() => setView("catalog")}
					variant={view === "catalog" ? "secondary" : "ghost"}
				>
					Catalogs
				</Button>
				{["slides", "spreadsheet", "document", "pdf"].map((kind) => (
					<Button
						key={kind}
						onClick={() => setView(kind)}
						variant={view === kind ? "secondary" : "ghost"}
					>
						Open {kind}
					</Button>
				))}
			</nav>
			{view === "catalog" ? (
				<div className="min-h-0 flex-1 overflow-auto p-6">
					<div className="mb-5 flex items-center gap-3">
						<p className="mr-auto text-muted-foreground text-sm">
							Real Ryu hooks and file viewer · controlled local API
						</p>
						<output className="text-sm" data-testid="read-count">
							{requests} catalog reads
						</output>
						<Button onClick={() => setCount((value) => value + 1)}>
							Add workspace
						</Button>
						<Button onClick={triggerGlobalRefresh} variant="outline">
							Refresh all
						</Button>
					</div>
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
						{Array.from({ length: count }, (_, index) => (
							<CatalogCard index={index} key={`consumer-${index}`} />
						))}
					</div>
				</div>
			) : (
				<div className="min-h-0 flex-1">
					<SpaceFileViewerPage documentId={view} key={view} spaceId="space-1" />
				</div>
			)}
		</main>
	);
}
const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<AppSurfaceProvider surface="desktop">
			<EntitlementProvider>
				<TabsProvider>
					<Shell />
				</TabsProvider>
			</EntitlementProvider>
		</AppSurfaceProvider>
	);
}
