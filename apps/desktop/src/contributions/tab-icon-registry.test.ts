import { describe, expect, test } from "bun:test";
import {
	registerTabIcon,
	resolveTabIcon,
	ruleFromItemTarget,
} from "./tab-icon-registry.ts";

describe("tab-icon-registry", () => {
	test("built-in spaces / page / database defaults", () => {
		expect(resolveTabIcon("/spaces")).toBe("delivery-secure-01");
		expect(resolveTabIcon("/spaces/abc")).toBe("delivery-secure-01");
		expect(resolveTabIcon("/spaces/abc/doc/xyz")).toBe("file-01");
		expect(resolveTabIcon("/spaces/abc/db/xyz")).toBe("database");
	});

	test("no built-in seed for an app-owned path", () => {
		// `/meetings` belongs to the `@ryu/meetings` app, which seeds its own icon
		// into this registry from the live contributions feed. A built-in row for it
		// painted a glyph whether or not the (not pre-installed) app was enabled.
		expect(resolveTabIcon("/meetings/m1")).toBeUndefined();
	});

	test("longest / most-specific rule wins", () => {
		const dispose = registerTabIcon({
			id: "test:canvas",
			pathPrefix: "/spaces",
			pathIncludes: "/app/@ryu/canvas",
			icon: "ai-image",
			priority: 20,
		});
		expect(resolveTabIcon("/spaces/s1/app/@ryu/canvas/d1")).toBe("ai-image");
		expect(resolveTabIcon("/spaces/s1/doc/d1")).toBe("file-01");
		dispose();
	});

	test("ruleFromItemTarget strips template segments", () => {
		const rule = ruleFromItemTarget(
			"/spaces/{{item.space_id}}/app/@ryu/canvas/{{item.id}}",
			"ai-image",
			"test:from-target"
		);
		expect(rule).toEqual({
			id: "test:from-target",
			pathPrefix: "/spaces",
			pathIncludes: "/app/@ryu/canvas",
			icon: "ai-image",
			priority: 20,
		});
	});

	test("ruleFromItemTarget declines a target whose identity is in the query", () => {
		// `/chat` is a shared shell route: every row of such a section opens the
		// same path, so a rule from it would repaint every chat tab in the app.
		expect(
			ruleFromItemTarget(
				"/chat?conversationId={{item.id}}",
				"lucide:loader-circle",
				"test:runs"
			)
		).toBeNull();
		// A static query carries no row identity and stays eligible.
		expect(
			ruleFromItemTarget("/library?section=agent", "target-01", "test:library")
		).not.toBeNull();
	});
});
