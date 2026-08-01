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
		expect(resolveTabIcon("/meetings/m1")).toBe("mic-01");
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
});
