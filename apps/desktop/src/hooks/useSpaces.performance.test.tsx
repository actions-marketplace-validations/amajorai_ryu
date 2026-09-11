import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AppDisabledError } from "@/src/lib/api/client.ts";

if (typeof document === "undefined") {
	GlobalRegistrator.register();
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const client = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
let node = { url: "http://node.test", token: "token", userJwt: "one" };
interface Read {
	reject: (error: Error) => void;
	resolve: (value: unknown) => void;
	signal: AbortSignal;
}
const reads: Read[] = [];
mock.module("@/src/lib/query-client.ts", () => ({ queryClient: client }));
mock.module("./useActiveNode.ts", () => ({ useActiveNode: () => node }));
mock.module("@/src/lib/core-refresh.ts", () => ({
	useCoreRefresh: () => undefined,
}));
mock.module("@/src/lib/gating/useEntityCap.ts", () => ({
	useEntityCap: () => ({ guard: () => true }),
}));
mock.module("@/src/lib/api/spaces.ts", () => ({
	fetchSpaces: (_target: unknown, signal: AbortSignal) =>
		new Promise((resolve, reject) => reads.push({ signal, resolve, reject })),
	createSpace: async () => ({ retrievalMode: "vector" }),
	createDatabase: async () => "db",
	createPage: async () => "page",
	createWhiteboard: async () => "board",
	deleteSpace: async () => undefined,
	renameSpace: async () => undefined,
	deleteDocument: async () => true,
	fetchDocument: async () => ({}),
	fetchDocuments: async () => [],
	ingestDocument: async () => undefined,
	searchSpace: async () => [],
	setDocumentIcon: async () => undefined,
	setSpaceIcon: async () => undefined,
	setSpaceVisibility: async () => undefined,
	setSpaceRetrievalMode: async () => ({ mode: "graph" }),
	updateDocument: async () => undefined,
	uploadSpaceFile: async () => ({ id: "file" }),
}));
const { useSpaces } = await import("./useSpaces.ts");
let root = createRoot(document.createElement("div"));
let first: ReturnType<typeof useSpaces>;
let second: ReturnType<typeof useSpaces>;
function Reader({ slot }: { slot: "first" | "second" }) {
	const result = useSpaces();
	if (slot === "first") {
		first = result;
	} else {
		second = result;
	}
	return null;
}
function Harness() {
	return (
		<>
			<Reader slot="first" />
			<Reader slot="second" />
		</>
	);
}
const settle = async (read: Read, name = "Research") =>
	act(async () => {
		read.resolve([{ id: "space", name, retrievalMode: "vector" }]);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
afterEach(async () => {
	await act(async () => root.unmount());
	client.clear();
	root = createRoot(document.createElement("div"));
	reads.length = 0;
	node = { ...node, userJwt: "one" };
});
test("cached list mutations and revision signals reach every observer of the same scope", async () => {
	await act(async () => root.render(<Harness />));
	expect(reads).toHaveLength(1);
	await settle(reads[0]);
	await act(async () => {
		await first.rename("space", "Renamed");
		await first.saveDocument("space", "doc", "Title", "Source");
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	expect(second.spaces[0].name).toBe("Renamed");
	expect(second.documentRevisions.get("space")).toBe(1);
	expect(reads).toHaveLength(1);
	node = { ...node, userJwt: "two" };
	await act(async () => root.render(<Harness />));
	expect(second.spaces).toEqual([]);
	expect(second.documentRevisions.size).toBe(0);
	await settle(reads[1], "Other user");
	await client.refetchQueries({ queryKey: ["space-document-revisions"] });
	node = { ...node, userJwt: "one" };
	await act(async () => root.render(<Harness />));
	expect(first.spaces[0].name).toBe("Renamed");
	expect(first.documentRevisions.get("space")).toBe(1);
	expect(reads).toHaveLength(2);
});
test("a mutation before first load cancels stale data and recovers the full list", async () => {
	await act(async () => root.render(<Harness />));
	let mutation = Promise.resolve();
	await act(async () => {
		mutation = first.rename("space", "New");
		await Promise.resolve();
	});
	expect(reads[0].signal.aborted).toBe(true);
	expect(reads).toHaveLength(2);
	await settle(reads[0], "Stale");
	await settle(reads[1], "New");
	await act(async () => {
		await mutation;
	});
	expect(second.spaces[0].name).toBe("New");
});
test("disabled-app errors retain their actionable state", async () => {
	await act(async () => root.render(<Harness />));
	await act(async () => {
		reads[0].reject(new AppDisabledError("@ryu/spaces", "Enable Spaces"));
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	expect(first.appDisabled?.app).toBe("@ryu/spaces");
	expect(first.error).toBeNull();
	expect(first.loading).toBe(false);
});
