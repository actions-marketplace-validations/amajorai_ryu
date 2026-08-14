// Real-browser spec for the Store/Library page chrome story (`e2e/harness/
// store-chrome-story.{html,tsx}`), which mounts the REAL `StoreSectionTabs` and
// `StoreGlobalSearch` from `packages/blocks/src/desktop/store.tsx`.
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
//     (`data-edges`: none → end → both → start), and an overflowing edge also
//     carries its scroll chevron — the affordance that replaced the strip's
//     visible scrollbars;
//   • NEITHER scrollbar is reachable on the strip: the old code hid them with a
//     `scrollbar-none` class defined in no stylesheet, and left `overflow-y` to
//     resolve to `auto` beside a non-visible `overflow-x`;
//   • the global search sits ABOVE the tabs, in the flow, and is bare (no
//     border, ring or shadow).

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

/** The bare global input of one page shell (`page` = 640px, `cramped` = 360px). */
const globalSearch = (page: Page, shell: string) =>
	page.locator(
		`[data-testid="${shell}-shell"] [data-slot="store-global-search"]`
	);

test.describe("store section tabs — pills, edges, and the global search", () => {
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
		// Scoped to the narrow panel: the story mounts THREE strips (the two sizing
		// panels plus the one inside the page shell), so a bare role lookup is a
		// strict-mode violation.
		//
		// Models sits past the right edge of the 420px column, so it has to be
		// scrolled into view first — and the click must land AFTER that scroll
		// settles, or it hits whichever pill is still under the pointer.
		const models = page
			.getByTestId("narrow-panel")
			.getByRole("tab", { name: "Models" });
		await models.scrollIntoViewIfNeeded();
		await expect(models).toBeInViewport();
		await models.click();
		await expect(models).toHaveAttribute("aria-selected", "true");
	});

	test("arrow keys walk the strip across a group divider", async ({ page }) => {
		await page.goto(STORY_URL);
		// Agents is the last tab of the "discover" cluster; Workflows opens "build",
		// so a divider <span> sits between them inside the tab list. Scoped to one
		// panel — the story mounts three strips.
		const agents = page
			.getByTestId("narrow-panel")
			.getByRole("tab", { name: "Agents" });
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
		await expect(scroller).toHaveAttribute("data-edges", "end", {
			timeout: 10_000,
		});

		// Mid-scroll: both edges have more.
		await scroller.evaluate((el) => {
			el.scrollLeft = Math.round((el.scrollWidth - el.clientWidth) / 2);
		});
		await expect(scroller).toHaveAttribute("data-edges", "both", {
			timeout: 10_000,
		});

		// Fully scrolled: only the leading edge.
		await scroller.evaluate((el) => {
			el.scrollLeft = el.scrollWidth;
		});
		await expect(scroller).toHaveAttribute("data-edges", "start", {
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
		await expect(scroller).toHaveAttribute("data-edges", "none");
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

	test("the global search field is bare", async ({ page }) => {
		await page.goto(STORY_URL);
		const input = globalSearch(page, "page");
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

	test("typing in the global search reports the query", async ({ page }) => {
		await page.goto(STORY_URL);
		const input = globalSearch(page, "page");
		await input.fill("notion");
		await expect(input).toHaveValue("notion");
		// Escape clears it in place — there is no dialog to dismiss.
		await input.press("Escape");
		await expect(input).toHaveValue("");
	});

	test("the search sits above the tabs, in the flow", async ({ page }) => {
		await page.goto(STORY_URL);
		const input = globalSearch(page, "page");
		const strip = page.locator(
			'[data-testid="page-shell"] [data-slot="store-section-tabs-scroller"]'
		);
		const inputBox = await input.boundingBox();
		const stripBox = await strip.boundingBox();
		expect(inputBox).not.toBeNull();
		expect(stripBox).not.toBeNull();
		if (inputBox && stripBox) {
			expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(stripBox.y + 1);
		}
		// In the flow, not floated over the content: the retired bottom bar was
		// `absolute`, and that is what forced every section to reserve its height.
		const positioned = await input.evaluate((el) => {
			let node: HTMLElement | null = el as HTMLElement;
			while (node && node.getAttribute("data-testid") !== "page-shell") {
				if (getComputedStyle(node).position === "absolute") {
					return true;
				}
				node = node.parentElement;
			}
			return false;
		});
		expect(positioned).toBe(false);
	});

	test("nothing scrolls the last row out of reach", async ({ page }) => {
		await page.goto(STORY_URL);
		const scroller = page.getByTestId("page-scroller");
		await scroller.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await expect(page.getByTestId("page-last-row")).toBeInViewport();
	});

	// The strip's own scrollbars. `overflow-x-auto` alone resolves `overflow-y` to
	// `auto` too, so a one-line pill row reserved a vertical bar as well as a
	// horizontal one — and the class meant to hide them (`scrollbar-none`) is
	// defined in no stylesheet in this repo. Asserted on the computed overflow and
	// on the measured gap between the client box and the border box, which is what
	// a painted scrollbar actually costs.
	test("the strip shows neither scrollbar", async ({ page }) => {
		await page.goto(STORY_URL);
		const metrics = await narrowScroller(page).evaluate((el) => {
			const s = getComputedStyle(el);
			return {
				gutterX: el.offsetHeight - el.clientHeight,
				gutterY: el.offsetWidth - el.clientWidth,
				overflowY: s.overflowY,
			};
		});
		expect(metrics.overflowY).toBe("hidden");
		expect(metrics.gutterX).toBeLessThanOrEqual(1);
		expect(metrics.gutterY).toBeLessThanOrEqual(1);
	});

	test("an overflowing edge offers a chevron that pages the strip", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		const scroller = narrowScroller(page);
		await expect(scroller).toHaveAttribute("data-edges", "end", {
			timeout: 10_000,
		});
		const forward = page
			.locator('[data-testid="narrow-panel"]')
			.getByRole("button", { name: "Scroll right" });
		await expect(forward).toHaveCount(1);
		// At rest it is invisible; the strip's hover is what reveals it.
		expect(await forward.evaluate((el) => getComputedStyle(el).opacity)).toBe(
			"0"
		);
		const before = await scroller.evaluate((el) => el.scrollLeft);
		await forward.dispatchEvent("click");
		await expect
			.poll(async () => scroller.evaluate((el) => el.scrollLeft), {
				timeout: 10_000,
			})
			.toBeGreaterThan(before);
	});

	test("a strip that fits offers no chevrons", async ({ page }) => {
		await page.goto(STORY_URL);
		await expect(
			page
				.locator('[data-testid="wide-panel"]')
				.getByRole("button", { name: /Scroll (left|right)/ })
		).toHaveCount(0);
	});

	test("the field survives a narrow pane", async ({ page }) => {
		await page.goto(STORY_URL);
		const input = globalSearch(page, "cramped");
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
