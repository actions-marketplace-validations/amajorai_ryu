import { Button } from "@ryu/ui/components/button.tsx";
import { createRoot } from "react-dom/client";
import { AppSurfaceProvider } from "@/src/contexts/app-surface-context.tsx";
import { EntitlementProvider } from "@/src/contexts/entitlement-context.tsx";
import {
	SpacesProvider,
	useSpacesContext,
} from "@/src/contexts/SpacesContext.tsx";
import { TabsProvider } from "@/src/contexts/TabsContext.tsx";
import SpacesPage from "@/src/pages/SpacesPage.tsx";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import "../../src/index.css";
useNodeStore.setState({
	nodes: [
		{
			name: "Alpha",
			url: "http://127.0.0.1:5212/alpha",
			token: null,
			userJwt: null,
		},
		{
			name: "Beta",
			url: "http://127.0.0.1:5212/beta",
			token: null,
			userJwt: null,
		},
	],
	defaultNode: "Alpha",
	autoSelect: false,
});
function Shell() {
	const { reload, spaces } = useSpacesContext();
	return (
		<main className="h-screen">
			<header className="flex items-center gap-3 border-b p-4">
				<h1 className="mr-auto font-semibold text-xl">
					Spaces · <span>{spaces[0]?.name}</span>
				</h1>
				<Button onClick={() => useNodeStore.setState({ defaultNode: "Alpha" })}>
					Alpha node
				</Button>
				<Button onClick={() => useNodeStore.setState({ defaultNode: "Beta" })}>
					Beta node
				</Button>
				<Button onClick={() => void reload()}>Refresh list</Button>
			</header>
			<SpacesPage />
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<AppSurfaceProvider surface="desktop">
		<EntitlementProvider>
			<TabsProvider>
				<SpacesProvider>
					<Shell />
				</SpacesProvider>
			</TabsProvider>
		</EntitlementProvider>
	</AppSurfaceProvider>
);
