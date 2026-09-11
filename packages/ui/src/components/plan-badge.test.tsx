import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanBadge, planTierColors, planTierGradient } from "./plan-badge.tsx";

const BUSINESS_GRADIENT =
	"linear-gradient(15deg,#5dffe4 0,#8dff9a 8%,#fff36a 16%,#60dfff 24%,#7b7cff 32%,#ff77d8 40%,#ffc45f 48%,#5dffe4 56%,#8dff9a 64%,#fff36a 72%,#60dfff 80%,#7b7cff 88%,#ff77d8 96%,#ffc45f 100%)";
const PRO_GRADIENT =
	"linear-gradient(15deg,#9effef 0,#d1ffd6 17%,#fff8ad 34%,#a3edff 51%,#bdbdff 68%,#ffb8eb 85%,#ffdda3 100%)";

describe("Business plan badge", () => {
	test("renders the Business label, title, and requested palette", () => {
		const html = renderToStaticMarkup(<PlanBadge plan="business" size="md" />);

		expect(html).toContain("BUSINESS");
		expect(html).toContain('title="Ryu Business"');
		expect(html).toContain(BUSINESS_GRADIENT);
		expect(html).toContain("t-plan-badge-business");
		expect(planTierGradient("business")).toBe(BUSINESS_GRADIENT);
		expect(planTierColors("business")).toEqual([
			"#5dffe4",
			"#8dff9a",
			"#fff36a",
			"#60dfff",
			"#7b7cff",
			"#ff77d8",
			"#ffc45f",
			"#5dffe4",
			"#8dff9a",
			"#fff36a",
			"#60dfff",
			"#7b7cff",
			"#ff77d8",
			"#ffc45f",
		]);
	});
});

describe("Pro plan badge", () => {
	test("keeps its separate holographic pastel palette", () => {
		const html = renderToStaticMarkup(<PlanBadge plan="pro" size="md" />);

		expect(planTierGradient("pro")).toBe(PRO_GRADIENT);
		expect(planTierGradient("pro")).not.toBe(BUSINESS_GRADIENT);
		expect(html).not.toContain("t-plan-badge-business");
	});
});

describe("Plus plan badge", () => {
	test("renders the private companion label, title, and palette", () => {
		const html = renderToStaticMarkup(<PlanBadge plan="plus" size="md" />);

		expect(html).toContain("PLUS");
		expect(html).toContain('title="Ryu Plus"');
		expect(planTierGradient("plus")).toContain("#b9f3ff");
		expect(planTierColors("plus")).toEqual([
			"#b9f3ff",
			"#9cc8ff",
			"#c3a4ff",
			"#f2b6e8",
		]);
	});
});

describe("Teams Lite plan badge", () => {
	test("keeps the Teams palette while naming the private tier", () => {
		const html = renderToStaticMarkup(
			<PlanBadge plan="teams-lite" size="md" />
		);

		expect(html).toContain("TEAMS LITE");
		expect(html).toContain('title="Ryu Teams Lite"');
		expect(html).toContain("#4f46e5");
	});
});

describe("Business plan badge motion", () => {
	test("uses a shared enlarged drift animation with a reduced-motion stop", async () => {
		const css = await Bun.file(
			new URL("../styles/globals.css", import.meta.url)
		).text();

		expect(css).toContain("@keyframes t-plan-badge-business-drift");
		expect(css).toContain("background-size: 300% 100%");
		expect(css).toContain(
			"animation: t-plan-badge-business-drift 8s ease-in-out infinite"
		);
		expect(
			css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"))
		).toContain(".t-plan-badge-business");
	});
});

describe("A Major Pass plan badge", () => {
	test("renders its own label, title, and palette", () => {
		const html = renderToStaticMarkup(
			<PlanBadge plan="marketplace-membership" size="md" />
		);

		expect(html).toContain("A MAJOR PASS");
		expect(html).toContain('title="Ryu A Major Pass"');
		expect(html).toContain("#c8942e");
	});
});

describe("Enterprise plan badge", () => {
	test("renders the original green enterprise palette", () => {
		const html = renderToStaticMarkup(
			<PlanBadge plan="enterprise" size="md" />
		);

		expect(html).toContain("ENTERPRISE");
		expect(html).toContain("#0f766e");
		expect(html).toContain("#059669");
		expect(html).toContain("#84cc16");
		expect(html).toContain("#f59e0b");
	});
});
