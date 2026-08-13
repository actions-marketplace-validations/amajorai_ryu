// Real-browser spec for the Store/Library page chrome story (`e2e/harness/
// store-chrome-story.{html,tsx}`), which mounts the REAL `StoreSectionTabs` and
// `StoreBottomSearch` from `packages/blocks/src/desktop/store.tsx`.
//
// Why a browser and not happy-dom: every claim here is a LAYOUT claim — whether
// the strip overflows, which edge is faded, whether the bottom bar covers the
// last row. jsdom/happy-dom report 0 for every width, which is precisely the
// failure mode that let the sidebar's label fade ship broken (an inline box
// measuring 0 against 0 and concluding "not clipped").
//
// Contract asserted:
//   • the strip is the shared `pills` tab variant — real `role="tab"` children
//     with `aria-selected`, and Base UI's roving arrow-key navigation, which the
//     hand-rolled buttons it replaced did not have;
//   • the group dividers (non-tab spans inside the tab list) do not swallow
//     arrow-key focus;
//   • the scrolled-edge fade engages ONLY while that edge has more to show
//     (`data-fade`: none → end → both → start);
//   • the bottom search field is bare (no border, ring or shadow) and, with the
//     scrolling column padded by the bar's height, the last row clears it.

import { expect, type Page, test } from "@playwright/test";

// The story pulls the blocks + ui module graphs; vite compiles them on first
// navigation, so allow headroom over the 30s default for a cold start.
test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/store-chrome-story.html";

const narrowScroller = (page: Page) =>
	page.locator(
		'[data-testid="narrow-panel"] [data-slot="store-section-tabs-scroller"]'
	);

const wideScroller = (page: Page) =>
	page.locator(
		'[data-testid="wide-panel"] [data-slot="store-section-tabs-scroller"]'
	);

/** The bare bottom input of one page shell (`page` = 640px, `cramped` = 360px). */
const bottomSearch = (page: Page, shell: string) =>
	page.locator(
		`[data-testid="${shell}-shell"] [data-slot="store-bottom-search"]`
	);

test.describe("store section tabs — pills, fade, and the bottom search", () => {
	test("renders the shared pill tabs, not hand-rolled buttons", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		const tabs = page.locator('[data-testid="narrow-panel"] [role="tab"]');
		await expect(tabs).toHaveCount(10);
		// Base UI owns the selected state; the strip only passes `value`.
		await expect(
			page.locator(
				'[data-testid="narrow-panel"] [role="tab"][aria-selected="true"]'
			)
		).toHaveText(/Home/);
		// The list is the `pills` variant of the shared primitive.
		await expect(
			page.locator('[data-testid="narrow-panel"] [data-slot="tabs-list"]')
		).toHaveAttribute("data-variant", "pills");
	});

	test("selecting a tab reports the section value", async ({ page }) => {
		await page.goto(STORY_URL);
		// Models sits past the right edge of the 420px column, so it has to be
		// scrolled into view first — and the click must land AFTER that scroll
		// settles, or it hits whichever pill is still under the pointer.
		const models = page.getByRole("tab", { name: "Models" });
		await models.scrollIntoViewIfNeeded();
		await expect(models).toBeInViewport();
		await models.click();
		await expect(models).toHaveAttribute("aria-selected", "true");
	});

	test("arrow keys walk the strip across a group divider", async ({ page }) => {
		await page.goto(STORY_URL);
		// Agents is the last tab of the "discover" cluster; Workflows opens "build",
		// so a divider <span> sits between them inside the tab list.
		const agents = page.getByRole("tab", { name: "Agents" });
		await agents.click();
		await agents.focus();
		await page.keyboard.press("ArrowRight");
		const focused = await page.evaluate(
			() => document.activeElement?.textContent ?? ""
		);
		expect(focused).toContain("Workflows");
	});

	test("the fade tracks which edge still has tabs to show", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		const scroller = narrowScroller(page);
		// 10 sections in a 420px column overflow, and the strip starts at scrollLeft
		// 0 — so only the trailing edge is faded.
		const metrics = await scroller.evaluate((el) => ({
			client: el.clientWidth,
			scroll: el.scrollWidth,
		}));
		expect(metrics.scroll).toBeGreaterThan(metrics.client);
		// The measurement rides the element's own scroll event, so these are polled
		// with headroom: a loaded CI box can be several frames late.
		await expect(scroller).toHaveAttribute("data-fade", "end", {
			timeout: 10_000,
		});

		// Mid-scroll: both edges have more.
		await scroller.evaluate((el) => {
			el.scrollLeft = Math.round((el.scrollWidth - el.clientWidth) / 2);
		});
		await expect(scroller).toHaveAttribute("data-fade", "both", {
			timeout: 10_000,
		});

		// Fully scrolled: only the leading edge.
		await scroller.evaluate((el) => {
			el.scrollLeft = el.scrollWidth;
		});
		await expect(scroller).toHaveAttribute("data-fade", "start", {
			timeout: 10_000,
		});

		// And the mask is really applied, not just the attribute.
		const mask = await scroller.evaluate(
			(el) => getComputedStyle(el).maskImage
		);
		expect(mask).toContain("linear-gradient");
	});

	test("a strip that fits carries no mask at all", async ({ page }) => {
		await page.goto(STORY_URL);
		const scroller = wideScroller(page);
		await expect(scroller).toHaveAttribute("data-fade", "none");
		const mask = await scroller.evaluate(
			(el) => getComputedStyle(el).maskImage
		);
		expect(mask).toBe("none");
	});

	test("the tab strip contains tabs only", async ({ page }) => {
		await page.goto(STORY_URL);
		// No input, button-that-is-not-a-tab, or select smuggled into the list —
		// non-tab children are what made the strip's overflow measurement a moving
		// target in the first place.
		const strays = page.locator(
			'[data-testid="narrow-panel"] [data-slot="tabs-list"] input, [data-testid="narrow-panel"] [data-slot="tabs-list"] select, [data-testid="narrow-panel"] [data-slot="tabs-list"] button:not([role="tab"])'
		);
		await expect(strays).toHaveCount(0);
	});

	test("the bottom search field is bare", async ({ page }) => {
		await page.goto(STORY_URL);
		const input = bottomSearch(page, "page");
		await expect(input).toBeVisible();
		const style = await input.evaluate((el) => {
			const s = getComputedStyle(el);
			return {
				borderBottomWidth: s.borderBottomWidth,
				borderTopWidth: s.borderTopWidth,
				boxShadow: s.boxShadow,
				outlineStyle: s.outlineStyle,
			};
		});
		expect(style.borderTopWidth).toBe("0px");
		expect(style.borderBottomWidth).toBe("0px");
		expect(style.boxShadow).toBe("none");
		expect(style.outlineStyle).toBe("none");
	});

	// Both widths: the padded column has to clear the bar in a cramped pane too,
	// where the bar is the same height but the rows are narrower.
	for (const shell of ["page", "cramped"]) {
		test(`the bottom bar does not cover the last row (${shell})`, async ({
			page,
		}) => {
			await page.goto(STORY_URL);
			const scroller = page.getByTestId(`${shell}-scroller`);
			await scroller.evaluate((el) => {
				el.scrollTop = el.scrollHeight;
			});
			const lastRow = page.getByTestId(`${shell}-last-row`);
			await expect(lastRow).toBeVisible();
			const rowBox = await lastRow.boundingBox();
			const barBox = await bottomSearch(page, shell).boundingBox();
			expect(rowBox).not.toBeNull();
			expect(barBox).not.toBeNull();
			if (rowBox && barBox) {
				// The last row is fully readable above the bar's top edge.
				expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(barBox.y + 1);
			}
		});
	}

	test("typing in the bottom search reports the query", async ({ page }) => {
		await page.goto(STORY_URL);
		const input = bottomSearch(page, "page");
		await input.fill("notion");
		await expect(input).toHaveValue("notion");
		// Escape clears it in place — there is no dialog to dismiss.
		await input.press("Escape");
		await expect(input).toHaveValue("");
	});

	// The bar shares the bottom of the pane with the shell's split-pane badge
	// (`Layout.tsx` → `PaneBadge`, `absolute bottom-2 left-2 z-10`). Neither the
	// pane box nor the page root opens a stacking context, so a z-index on the bar
	// outranks the badge and an opaque strip erases it. The bar therefore carries
	// none — asserted on the mechanism, not just the pixels, so a "z-30 to fix
	// something else" cannot come back silently.
	test("the bar never outranks the pane badge", async ({ page }) => {
		await page.goto(STORY_URL);
		const bar = page.locator(
			'[data-testid="page-shell"] [data-slot="store-bottom-search"]'
		);
		// The slot is on the input; the positioned strip is its grandparent
		// (strip → centered row → input).
		const barLayer = await bar.evaluate((el) => {
			const strip = el.parentElement?.parentElement;
			return strip ? getComputedStyle(strip).zIndex : "missing";
		});
		expect(barLayer).toBe("auto");
		const badgeLayer = await page
			.getByTestId("page-badge")
			.evaluate((el) => getComputedStyle(el).zIndex);
		expect(badgeLayer).toBe("10");
	});

	test("the pane badge paints over the bar, not under it", async ({ page }) => {
		await page.goto(STORY_URL);
		const badge = page.getByTestId("page-badge");
		const box = await badge.boundingBox();
		expect(box).not.toBeNull();
		if (!box) {
			return;
		}
		const topmost = await page.evaluate(
			({ x, y }) => {
				const el = document.elementFromPoint(x, y);
				return el?.closest("[data-testid]")?.getAttribute("data-testid") ?? "";
			},
			{ x: box.x + 8, y: box.y + box.height / 2 }
		);
		expect(topmost).toBe("page-badge");
	});

	// A cramped pane is the worst case for both: the badge covers a bigger share
	// of the row, and the input has the least room. The input must still be the
	// element you hit where it is visible, and the shell must not scroll sideways.
	test("the bar survives a narrow pane", async ({ page }) => {
		await page.goto(STORY_URL);
		const input = bottomSearch(page, "cramped");
		await expect(input).toBeVisible();
		const box = await input.boundingBox();
		expect(box).not.toBeNull();
		if (box) {
			expect(box.width).toBeGreaterThan(120);
		}
		const shell = page.getByTestId("cramped-shell");
		const overflows = await shell.evaluate(
			(el) => el.scrollWidth - el.clientWidth
		);
		expect(overflows).toBeLessThanOrEqual(1);
		await input.fill("mcp");
		await expect(input).toHaveValue("mcp");
	});
});
