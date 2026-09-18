import { Button } from "@ryu/ui/components/button";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SubscriptionUsageDashboard } from "../../src/components/usage/SubscriptionUsageDashboard.tsx";
import { IsActiveTabProvider } from "../../src/contexts/TabsContext.tsx";
import { useSubscriptionUsage } from "../../src/hooks/useSubscriptionUsage.ts";
import type { PiCatalog } from "../../src/lib/api/pi-config.ts";
import { useNodeStore } from "../../src/store/useNodeStore.ts";
import "../../src/index.css";

const node = { name: "usage-proof", url: location.origin, token: null };
useNodeStore.setState({
	localNodes: [node],
	nodes: [node],
	defaultNode: node.name,
});
const client = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
const catalog = {
	providers: [
		{
			id: "codex",
			label: "ChatGPT",
			authKind: "subscription",
			managed: false,
			accounts: [
				{
					accountId: "personal",
					label: "Personal",
					kind: "oauth",
					active: true,
				},
			],
		},
	],
} as unknown as PiCatalog;

function Usage() {
	const usage = useSubscriptionUsage(catalog);
	return (
		<SubscriptionUsageDashboard
			accounts={usage.accounts}
			catalogLoading={false}
			onRefresh={usage.refresh}
			refreshing={usage.refreshing}
		/>
	);
}
function Story() {
	const [active, setActive] = useState(false);
	return (
		<QueryClientProvider client={client}>
			<main className="min-h-screen bg-background p-8 text-foreground">
				<div className="mb-6 flex gap-2">
					<Button onClick={() => setActive(!active)}>
						{active ? "Hide usage" : "Show usage"}
					</Button>
				</div>
				<IsActiveTabProvider isActive={active}>
					<div hidden={!active}>
						<Usage />
					</div>
				</IsActiveTabProvider>
			</main>
		</QueryClientProvider>
	);
}
const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
