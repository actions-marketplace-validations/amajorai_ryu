import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

if (typeof document === "undefined") {
	GlobalRegistrator.register();
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let node = {
	url: "http://node.test",
	token: "node-token",
	userJwt: "user-one",
};
const requests: Array<{
	jwt: string;
	signal: AbortSignal;
	resolve: (value: unknown) => void;
}> = [];
mock.module("@/src/hooks/useActiveNode.ts", () => ({
	useActiveNode: () => node,
}));
mock.module("@/src/lib/api/plugins.ts", () => ({
	getPluginContributions: (target: typeof node, signal: AbortSignal) =>
		new Promise((resolve) =>
			requests.push({ jwt: target.userJwt, signal, resolve })
		),
}));
mock.module("@/src/components/views/DeclarativeView.tsx", () => ({
	HelloDeclarativeViewHarness: () => null,
}));
mock.module("@/src/contributions/registry.ts", () => ({
	contributionRegistry: {},
}));
mock.module("@/src/contributions/tab-icon-registry.ts", () => ({
	registerTabIcon: () => () => undefined,
	ruleFromItemTarget: () => null,
}));
mock.module("@/src/lib/realtime/use-realtime-room.ts", () => ({
	useRealtimeRoom: () => undefined,
}));
mock.module("@/src/pages/PluginCompanionPage.tsx", () => ({
	default: () => null,
}));
mock.module("@/src/pages/PluginViewPage.tsx", () => ({ default: () => null }));
const { usePluginContributionsQuery } = await import(
	"./usePluginContributions.ts"
);
const client = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
const root = createRoot(document.createElement("div"));
let latest: ReturnType<typeof usePluginContributionsQuery>;
function Reader() {
	latest = usePluginContributionsQuery();
	return null;
}
function Harness() {
	return (
		<QueryClientProvider client={client}>
			<Reader />
			<Reader />
		</QueryClientProvider>
	);
}
afterEach(async () => {
	await act(async () => root.unmount());
	client.clear();
});
test("mounts share a read while changed credentials cancel and isolate pending contributions", async () => {
	await act(async () => root.render(<Harness />));
	expect(requests).toHaveLength(1);
	expect(requests[0].jwt).toBe("user-one");
	node = { ...node, userJwt: "user-two" };
	await act(async () => root.render(<Harness />));
	expect(requests).toHaveLength(2);
	expect(requests[0].signal.aborted).toBe(true);
	expect(requests[1].jwt).toBe("user-two");
	await act(async () => {
		requests[0].resolve({ companions: [{ id: "old" }] });
		requests[1].resolve({ companions: [{ id: "current" }] });
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	expect(latest!.data?.companions.map((item) => item.id)).toEqual(["current"]);
	await act(async () => root.render(<Harness />));
	expect(requests).toHaveLength(2);
});
