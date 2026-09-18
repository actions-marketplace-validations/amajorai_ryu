import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";

if (typeof document === "undefined") {
	GlobalRegistrator.register();
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const signals: AbortSignal[] = [];
const queries: string[] = [];
mock.module("@/src/lib/api/marketplace.ts", () => ({
	fetchCatalog: (_kind: string, query: string, signal?: AbortSignal) => {
		queries.push(query);
		return new Promise<never>((_resolve, reject) => {
			if (signal) {
				signals.push(signal);
				signal.addEventListener("abort", () => reject(new Error("aborted")), {
					once: true,
				});
			}
		});
	},
}));

const { useMarketplaceCatalog } = await import("./useMarketplaceCatalog.ts");
let root = createRoot(document.createElement("div"));
let state: ReturnType<typeof useMarketplaceCatalog>;

function Reader() {
	state = useMarketplaceCatalog("skill", "seed");
	return null;
}

afterEach(async () => {
	await act(() => root.unmount());
	root = createRoot(document.createElement("div"));
	signals.length = 0;
	queries.length = 0;
});

test("Marketplace search aborts the previous request when the catalog kind changes", async () => {
	await act(() => root.render(<Reader />));
	expect(signals).toHaveLength(1);
	expect(queries).toEqual(["seed"]);

	await act(() => state.setKind("plugin"));

	expect(signals).toHaveLength(2);
	expect(signals[0]?.aborted).toBe(true);
});
