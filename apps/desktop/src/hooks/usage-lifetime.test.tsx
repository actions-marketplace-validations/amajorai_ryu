import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PiCatalog } from "@/src/lib/api/pi-config.ts";

if (typeof document === "undefined") {
	GlobalRegistrator.register();
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let node = { url: "https://node.test", token: "one", userJwt: "caller-one" };
let accountTabActive = true;
mock.module("@/src/contexts/TabsContext.tsx", () => ({
	useIsActiveTab: () => accountTabActive,
}));
mock.module("./useActiveNode.ts", () => ({ useActiveNode: () => node }));
const reads: Array<{
	kind: string;
	signal: AbortSignal;
	resolve: (value: unknown) => void;
}> = [];
mock.module("@/src/lib/api/usage.ts", () => ({
	supportsUsage: (id: string) => id === "acp:codex",
	fetchAgentUsage: (_target: unknown, _id: string, signal: AbortSignal) =>
		new Promise((resolve) => reads.push({ kind: "agent", signal, resolve })),
	fetchProviderAccountUsage: (
		_target: unknown,
		_provider: string,
		_account: string,
		signal: AbortSignal
	) =>
		new Promise((resolve) => reads.push({ kind: "account", signal, resolve })),
}));
const { useAgentUsage } = await import("./useAgentUsage.ts");
const { useSubscriptionUsage } = await import("./useSubscriptionUsage.ts");
const catalog = {
	providers: [
		{
			id: "codex",
			label: "Codex",
			authKind: "subscription",
			managed: false,
			accounts: [
				{ accountId: "one", label: "One", kind: "oauth", active: true },
			],
		},
	],
} as unknown as PiCatalog;
const client = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
const root = createRoot(document.createElement("div"));
function Agent({ active }: { active: boolean }) {
	useAgentUsage("acp:codex", active);
	return null;
}
function Accounts() {
	useSubscriptionUsage(catalog);
	return null;
}
const render = async (active: boolean, accounts = false) => {
	await act(() =>
		root.render(
			<QueryClientProvider client={client}>
				<Agent active={active} />
				<Agent active={active} />
				{accounts && <Accounts />}
			</QueryClientProvider>
		)
	);
	await act(async () => {
		await Bun.sleep(10);
	});
};
afterEach(async () => {
	await act(() => root.unmount());
	client.clear();
});
test("inactive usage observers stay quiet, cancel on hide and separate credential scopes", async () => {
	await render(false);
	expect(reads).toHaveLength(0);
	await render(true);
	expect(reads).toHaveLength(1);
	await render(false);
	expect(reads[0].signal.aborted).toBe(true);
	await render(true, true);
	expect(reads).toHaveLength(3);
	const accountQueryFns = client
		.getQueryCache()
		.getAll()
		.filter((query) => query.queryKey[0] === "provider-account-usage")
		.map((query) => query.options.queryFn);
	await render(true, true);
	expect(reads).toHaveLength(3);
	expect(
		client
			.getQueryCache()
			.getAll()
			.filter((query) => query.queryKey[0] === "provider-account-usage")
			.map((query) => query.options.queryFn)
	).toEqual(accountQueryFns);
	await act(async () => {
		reads[1].resolve({ available: true });
		reads[2].resolve({ available: true });
		await Bun.sleep(10);
	});
	node = { ...node, token: "two" };
	await render(true, true);
	expect(reads).toHaveLength(5);
	expect(
		reads
			.slice(3)
			.map((read) => read.kind)
			.sort()
	).toEqual(["account", "agent"]);
	node = { ...node, userJwt: "caller-two" };
	await render(true, true);
	expect(reads).toHaveLength(7);
	expect(reads[3].signal.aborted).toBe(true);
	expect(reads[4].signal.aborted).toBe(true);
	accountTabActive = false;
	await render(false, true);
	expect(reads[6].signal.aborted).toBe(true);
	expect(
		client
			.getQueryCache()
			.getAll()
			.every((query) => query.getObserversCount() === 0)
	).toBe(true);
	accountTabActive = true;
	await render(false, true);
	expect(reads).toHaveLength(8);
	await act(async () => {
		reads[7].resolve({ available: true });
		await Bun.sleep(10);
	});
	accountTabActive = false;
	await render(false, true);
	accountTabActive = true;
	await render(false, true);
	expect(reads).toHaveLength(8);
});
