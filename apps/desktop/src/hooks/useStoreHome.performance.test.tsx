import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

if (typeof document === "undefined") {
	GlobalRegistrator.register();
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const node = {
	token: "node-token",
	url: "http://node.test",
	userJwt: "user-one",
};

mock.module("@/src/components/skills/SkillDistributionProvider.tsx", () => ({
	useSkillDistributionFlow: () => ({
		installCatalogSkill: () => Promise.resolve(),
	}),
}));
mock.module("@/src/hooks/useActiveNode.ts", () => ({
	useActiveNode: () => node,
}));
mock.module("@/src/lib/api/agents.ts", () => ({
	fetchAgentCatalog: () => Promise.resolve([]),
	installAgent: () => Promise.resolve(),
}));
mock.module("@/src/lib/api/client.ts", () => ({
	request: () => Promise.resolve({}),
}));
mock.module("@/src/lib/api/gateway.ts", () => ({
	updateGatewayConfig: () => Promise.resolve(),
}));
mock.module("@/src/lib/api/mcp.ts", () => ({
	installMcpServer: () => Promise.resolve(),
	searchMcpCatalog: () => Promise.resolve({ servers: [] }),
}));
mock.module("@/src/lib/api/models.ts", () => ({
	installModelSnapshot: () => Promise.resolve(),
	searchModels: () => Promise.resolve({ models: [] }),
}));
mock.module("@/src/lib/api/plugins.ts", () => ({
	fetchApps: () => Promise.resolve([]),
	fetchAppsCatalog: () => Promise.resolve([]),
	installApp: () => Promise.resolve(),
	installPluginFromCatalog: () => Promise.resolve(),
}));
mock.module("@/src/lib/api/skills.ts", () => ({
	searchSkills: () => Promise.resolve([]),
}));

const { useStoreHome } = await import("./useStoreHome.ts");
const client = new QueryClient({
	defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
});
let root = createRoot(document.createElement("div"));

function Reader() {
	useStoreHome();
	return null;
}

function Harness() {
	return (
		<QueryClientProvider client={client}>
			<Reader />
		</QueryClientProvider>
	);
}

afterEach(async () => {
	await act(() => root.unmount());
	client.clear();
	root = createRoot(document.createElement("div"));
});

test("Store Home retains its seven realm query descriptors across renders", async () => {
	await act(() => root.render(<Harness />));
	const keys = new Set(["store-home", "apps", "agents"]);
	const first = client
		.getQueryCache()
		.getAll()
		.filter((query) => keys.has(String(query.queryKey[0])))
		.sort((a, b) => String(a.queryKey).localeCompare(String(b.queryKey)))
		.map((query) => query.options.queryFn);
	expect(first).toHaveLength(7);

	await act(() => root.render(<Harness />));
	const second = client
		.getQueryCache()
		.getAll()
		.filter((query) => keys.has(String(query.queryKey[0])))
		.sort((a, b) => String(a.queryKey).localeCompare(String(b.queryKey)))
		.map((query) => query.options.queryFn);
	expect(second).toEqual(first);
});
