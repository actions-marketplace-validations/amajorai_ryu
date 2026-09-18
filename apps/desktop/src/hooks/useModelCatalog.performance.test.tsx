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

mock.module("@/src/hooks/useActiveNode.ts", () => ({
	useActiveNode: () => node,
}));
mock.module("@/src/lib/api/models.ts", () => ({
	fetchModelDetail: () => Promise.resolve(null),
	fetchModelSources: () => Promise.resolve({ sources: [] }),
	installModelFile: () => Promise.resolve(),
	installModelSnapshot: () => Promise.resolve(),
	searchModels: () => Promise.resolve({ models: [], nextCursor: null }),
	selectModelSource: () => Promise.resolve(),
	uninstallModelFile: () => Promise.resolve(),
	MODEL_CATEGORY_TASK: {},
}));

const { useModelCatalog } = await import("./useModelCatalog.ts");
const client = new QueryClient({
	defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
});
let root = createRoot(document.createElement("div"));

function Reader() {
	useModelCatalog();
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

test("Model catalog retains its three query descriptors across renders", async () => {
	await act(() => root.render(<Harness />));
	const first = client
		.getQueryCache()
		.getAll()
		.filter((query) => query.queryKey[0] === "models")
		.sort((a, b) => String(a.queryKey).localeCompare(String(b.queryKey)))
		.map((query) => query.options.queryFn);
	expect(first).toHaveLength(3);

	await act(() => root.render(<Harness />));
	const second = client
		.getQueryCache()
		.getAll()
		.filter((query) => query.queryKey[0] === "models")
		.sort((a, b) => String(a.queryKey).localeCompare(String(b.queryKey)))
		.map((query) => query.options.queryFn);
	expect(second).toEqual(first);
});
