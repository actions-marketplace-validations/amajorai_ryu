import { Button } from "@ryu/ui/components/button.tsx";
import { Input } from "@ryu/ui/components/input.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FederatedTab } from "../../../web/src/components/marketplace/discovery-tabs.tsx";
import { UniversalSearchResults } from "../../../web/src/components/marketplace/universal-search.tsx";
import { WebStoreCard } from "../../../web/src/components/marketplace/web-store-card.tsx";
import { useFederatedCatalog } from "../../../web/src/hooks/use-catalog.ts";
import {
	useMarketplaceCatalog,
	useStaffPicks,
} from "../../../web/src/hooks/use-marketplace.ts";
import { useUniversalSearch } from "../../../web/src/hooks/use-universal-search.ts";
import type { FederatedKind } from "../../../web/src/lib/catalog-api.ts";
import "../../src/index.css";
const client = new QueryClient();
function Reader({ kind }: { kind: FederatedKind }) {
	useFederatedCatalog(kind);
	return null;
}
function UniversalProof() {
	const search = useUniversalSearch();
	return (
		<div className="flex flex-col gap-6">
			<Input
				aria-label="Search the Store"
				onChange={(event) => search.setQuery(event.target.value)}
				value={search.query}
			/>
			{search.hasQuery ? (
				<UniversalSearchResults
					isEmpty={search.isEmpty}
					loading={search.loading}
					results={search.results}
				/>
			) : (
				<p>Search the Store</p>
			)}
		</div>
	);
}
function MarketplaceLists() {
	const catalog = useMarketplaceCatalog("plugin");
	const picks = useStaffPicks(catalog.kind);
	return (
		<>
			<div className="mb-6 flex gap-3">
				<Button onClick={() => catalog.setKind("skill")}>Skills catalog</Button>
				<Button
					onClick={() => {
						for (let i = 0; i < 10; i++) {
							void catalog.refresh();
							void picks.refresh();
						}
					}}
				>
					Refresh lists
				</Button>
			</div>
			<h2>Catalog</h2>
			{catalog.items.map((card) => (
				<WebStoreCard
					description={card.description}
					key={card.id}
					name={card.name}
					seedId={card.id}
				/>
			))}
			<h2>Staff Picks</h2>
			{picks.items.map((card) => (
				<WebStoreCard
					description={card.description}
					key={card.id}
					name={card.name}
					seedId={card.id}
				/>
			))}
		</>
	);
}
function MarketplaceListsProof() {
	const [open, setOpen] = useState(true);
	return (
		<>
			<Button onClick={() => setOpen(!open)}>
				{open ? "Close lists" : "Open lists"}
			</Button>
			{open && <MarketplaceLists />}
		</>
	);
}
function App() {
	const [kind, setKind] = useState<FederatedKind>("model");
	const [extra, setExtra] = useState(false);
	return (
		<QueryClientProvider client={client}>
			<main className="min-h-screen bg-background p-8 text-foreground">
				<h1 className="mb-6 font-semibold text-2xl">Store</h1>
				{location.search.includes("marketplace-lists") ? (
					<MarketplaceListsProof />
				) : location.search.includes("universal") ? (
					<UniversalProof />
				) : (
					<>
						<div className="mb-6 flex gap-3">
							<Button onClick={() => setKind("model")}>Models</Button>
							<Button onClick={() => setKind("mcp")}>MCP</Button>
							<Button onClick={() => setExtra(true)}>Add reader</Button>
						</div>
						{extra && <Reader kind={kind} />}
						<FederatedTab kind={kind} placeholder="Search catalog…" />
					</>
				)}
			</main>
		</QueryClientProvider>
	);
}
createRoot(document.getElementById("root")!).render(<App />);
