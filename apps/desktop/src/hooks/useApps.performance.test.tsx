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
	url: "http://node.test",
	token: "node-token",
	userJwt: "user-one",
};
const requests: Array<{
	options?: { signal?: AbortSignal };
	resolve: (value: unknown) => void;
}> = [];
mock.module("@/src/hooks/useActiveNode.ts", () => ({
	useActiveNode: () => node,
}));
mock.module("@/src/lib/api/plugins.ts", () => ({
	getPluginContributions: () => Promise.resolve({ companions: [], views: [] }),
	fetchApps: (_target: unknown, options?: { signal?: AbortSignal }) =>
		new Promise((resolve) => requests.push({ options, resolve })),
	disableApp: () => Promise.reject(new Error("unused")),
	enableApp: () => Promise.reject(new Error("unused")),
	installApp: () => Promise.reject(new Error("unused")),
	uninstallApp: () => Promise.reject(new Error("unused")),
	describeDependencyError: () => "unused",
}));
mock.module("@/src/lib/core-refresh.ts", () => ({
	triggerGlobalRefresh: () => undefined,
}));
mock.module("@ryu/ui/components/sileo", () => ({
	toast: { warning: () => undefined },
}));

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
mock.module("@/src/lib/query-client.ts", () => ({ queryClient }));
const { useApps } = await import("./useApps.ts");

let root = createRoot(document.createElement("div"));
afterEach(async () => {
	await act(async () => root.unmount());
	queryClient.clear();
	requests.length = 0;
	root = createRoot(document.createElement("div"));
});

test("app roster readers ignore status-only background refetches", async () => {
	let renders = 0;
	function Reader() {
		useApps();
		renders += 1;
		return null;
	}

	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<Reader />
			</QueryClientProvider>
		)
	);
	expect(requests).toHaveLength(1);
	const beforeData = renders;
	const payload = [{ id: "@ryu/calendar", enabled: true }];
	await act(async () => {
		requests[0].resolve(payload);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	expect(renders).toBeGreaterThan(beforeData);
	const afterData = renders;

	await act(async () => {
		void queryClient.invalidateQueries({ queryKey: ["desktop-app-roster"] });
	});
	expect(requests).toHaveLength(2);
	expect(renders).toBe(afterData);
	await act(async () => {
		requests[1].resolve(payload);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	expect(renders).toBe(afterData);
});
