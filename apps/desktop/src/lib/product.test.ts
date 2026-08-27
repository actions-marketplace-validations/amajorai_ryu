import { describe, expect, test } from "bun:test";
import {
	desktopProductName,
	isBotRoutePath,
	isRyuStandaloneApp,
	resolveDesktopProduct,
} from "./product.ts";

describe("desktop product variant", () => {
	test("defaults unknown values to the full Ryu Build product", () => {
		expect(resolveDesktopProduct(undefined)).toBe("build");
		expect(resolveDesktopProduct("desktop")).toBe("build");
		expect(desktopProductName("build")).toBe("Ryu");
	});

	test("recognizes the managed Bot product", () => {
		expect(resolveDesktopProduct("bot")).toBe("bot");
		expect(desktopProductName("bot")).toBe("Ryu Bot");
	});

	test("recognizes the standalone app host product", () => {
		expect(resolveDesktopProduct("app")).toBe("app");
		expect(desktopProductName("app")).toBe("Ryu App");
		// The test bundle is the normal Build product, so this remains false here;
		// the predicate is covered by the compile-time product resolver above.
		expect(isRyuStandaloneApp()).toBe(false);
	});

	test("allows chat routes and rejects advanced product routes", () => {
		expect(isBotRoutePath("/chat")).toBe(true);
		expect(isBotRoutePath("/chat/agent/ryu")).toBe(true);
		expect(isBotRoutePath("/store")).toBe(false);
		expect(isBotRoutePath("/agents/ryu/edit")).toBe(false);
	});
});
