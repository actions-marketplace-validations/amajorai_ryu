import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanBadge } from "./plan-badge.tsx";

describe("Business plan badge", () => {
	test("renders the Business label and title", () => {
		const html = renderToStaticMarkup(<PlanBadge plan="business" size="md" />);

		expect(html).toContain("BUSINESS");
		expect(html).toContain('title="Ryu Business"');
	});
});
