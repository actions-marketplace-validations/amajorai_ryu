import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
	notifyManager,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

if (typeof document === "undefined") {
	GlobalRegistrator.register();
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
notifyManager.setScheduler(queueMicrotask);

const client = new QueryClient({
	defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
});
let node = {
	token: "node-token",
	url: "http://node.test",
	userJwt: "user-one",
};
const spaces = [
	{ id: "space-one", name: "One" },
	{ id: "space-two", name: "Two" },
];
const documentRevisions = new Map([
	["space-one", 1],
	["space-two", 2],
]);
const reads: Array<{
	resolve: (value: unknown) => void;
	signal: AbortSignal | null | undefined;
}> = [];

mock.module("@/src/hooks/useActiveNode.ts", () => ({
	useActiveNode: () => node,
}));
mock.module("@/src/contexts/SpacesContext.tsx", () => ({
	useSpacesContext: () => ({
		documentRevisions,
		error: null,
		loading: false,
		spaces,
	}),
}));
mock.module("@/src/hooks/useSidebarSectionSource.ts", () => ({
	useSidebarSectionSources: () => [],
}));
mock.module("@/src/lib/query-client.ts", () => ({ queryClient: client }));
mock.module("@/src/lib/api/client.ts", () => ({
	toTarget: (value: typeof node) => value,
}));
mock.module("@/src/lib/api/output-styles.ts", () => ({
	listOutputStyles: async () => ({ styles: [] }),
}));
mock.module("@/src/lib/api/spaces.ts", () => ({
	fetchDocuments: (
		_target: typeof node,
		_spaceId: string,
		signal: AbortSignal
	) =>
		new Promise((resolve) => {
			reads.push({ resolve, signal });
		}),
}));

const { useMentionableResources } = await import(
	"./useMentionableResources.ts"
);
let latest: ReturnType<typeof useMentionableResources>;
let root = createRoot(document.createElement("div"));

function Reader() {
	latest = useMentionableResources([]);
	return null;
}

function Harness() {
	return (
		<QueryClientProvider client={client}>
			<Reader />
		</QueryClientProvider>
	);
}

const flush = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

afterEach(async () => {
	await act(async () => root.unmount());
	client.clear();
	root = createRoot(document.createElement("div"));
	reads.length = 0;
	node = { ...node, userJwt: "user-one" };
});

test("chat mention document observers keep stable descriptors across renders", async () => {
	await act(async () => root.render(<Harness />));
	await flush();
	expect(reads).toHaveLength(2);
	const queryFns = client
		.getQueryCache()
		.getAll()
		.filter((query) => query.queryKey[0] === "space-documents")
		.map((query) => query.options.queryFn);

	await act(async () => root.render(<Harness />));
	await flush();
	expect(reads).toHaveLength(2);
	expect(
		client
			.getQueryCache()
			.getAll()
			.filter((query) => query.queryKey[0] === "space-documents")
			.map((query) => query.options.queryFn)
	).toEqual(queryFns);
	expect(latest.pages).toEqual([]);
});
