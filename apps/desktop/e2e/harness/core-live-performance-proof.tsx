import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import InstalledSection from "@/src/components/store/InstalledSection.tsx";
import { AppSurfaceProvider } from "@/src/contexts/app-surface-context.tsx";
import { queryClient } from "@/src/lib/query-client.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import "../../src/index.css";
useNodeStore.setState({
	nodes: [
		{
			name: "Isolated performance node",
			url: location.origin,
			token: null,
			userJwt: null,
		},
	],
	defaultNode: "Isolated performance node",
	autoSelect: false,
});
queryClient.setDefaultOptions({
	queries: { retry: false, refetchOnWindowFocus: false },
});
createRoot(document.getElementById("root")!).render(
	<MemoryRouter>
		<QueryClientProvider client={queryClient}>
			<AppSurfaceProvider surface="desktop">
				<main className="h-screen overflow-auto p-6">
					<InstalledSection />
				</main>
			</AppSurfaceProvider>
		</QueryClientProvider>
	</MemoryRouter>
);
