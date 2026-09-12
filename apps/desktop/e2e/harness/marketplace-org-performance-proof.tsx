import {
	type MarketplaceHost,
	MarketplaceHostProvider,
} from "@ryu/marketplace/host";
import { LicensesTab } from "@ryu/marketplace/licenses-tab";
import { Button } from "@ryu/ui/components/button.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { SellerReportsPanel } from "../../../../packages/marketplace/src/seller-reports.tsx";
import {
	useMarketplaceMembershipReport,
	useMyLicenses,
	useSellerReports,
	useSellerStatus,
} from "../../../web/src/hooks/use-marketplace.ts";
import { useAuthState } from "./marketplace-auth-state.ts";
import "../../src/index.css";
const client = new QueryClient();
const host: MarketplaceHost = {
	useLicenses: useMyLicenses,
	useSellerStatus,
	useSellerReports,
	openExternal: () => undefined,
	startPurchase: async () => {
		throw new Error("Read-only proof");
	},
};
function Reader() {
	useMyLicenses();
	const { status } = useSellerStatus();
	const { report } = useMarketplaceMembershipReport();
	useEffect(() => {
		document.documentElement.dataset.seller =
			status?.stripeConnectAccountId ?? "";
		document.documentElement.dataset.reportOrg = report?.organizationId ?? "";
	}, [status, report]);
	return null;
}
function ReportReader() {
	useSellerReports();
	return null;
}
function App() {
	return (
		<QueryClientProvider client={client}>
			<MarketplaceHostProvider host={host}>
				<main className="min-h-screen bg-background p-8 text-foreground">
					<h1 className="mb-6 font-semibold text-2xl">Marketplace</h1>
					<div className="flex gap-3">
						<Button onClick={() => useAuthState.setState({ user: "beta" })}>
							Account Beta
						</Button>
						<Button
							onClick={() => useAuthState.setState({ organization: "other" })}
						>
							Other organization
						</Button>
						<Button onClick={() => useAuthState.setState({ user: null })}>
							Sign out
						</Button>
					</div>
					{location.search.includes("reports") ? (
						<>
							<ReportReader />
							<SellerReportsPanel />
						</>
					) : (
						<>
							<Reader />
							<Reader />
							<LicensesTab />
						</>
					)}
				</main>
			</MarketplaceHostProvider>
		</QueryClientProvider>
	);
}
createRoot(document.getElementById("root")!).render(<App />);
