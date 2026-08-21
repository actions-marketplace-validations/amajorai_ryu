// Real-browser spec for the chat-row menus story (`e2e/harness/
// chat-row-menus-story.{html,tsx}`), which mounts the REAL sidebar `ChatRow`
// against a stubbed `/api/plugins/contributions`.
//
// What it certifies, none of which a type-check can see:
//   • the ⋯ dropdown and the right-click menu list the SAME app-contributed
//     rows — the regression this story exists for was a context menu that
//     rendered none of them, so an app's row was invisible to anyone who
//     reaches for right-click;
//   • the contributed section is anchored: a `space` row never leaks into a
//     conversation's menu;
//   • `order` sorts the contributed rows on BOTH surfaces, not just the one
//     that happened to have the section;
//   • a contributed row in the RIGHT-CLICK menu actually dispatches — same
//     capability, same `conversation_id` — rather than merely rendering.

import { expect, type Page, test } from "@playwright/test";

// The story pulls the full AppSidebar module graph; vite compiles it on first
// navigation, so allow headroom over the 30s default for cold-start CI runs.
test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/chat-row-menus-story.html";
const ROW_TITLE = "Fix the flaky auth test";

/** The row itself (the context-menu trigger), not the title span inside it. */
function row(page: Page) {
	return page.locator('div[role="button"]', { hasText: ROW_TITLE }).first();
}

/**
 * Open the ⋯ dropdown. Two quirks make this fiddlier than a click: the trigger
 * is `display:none` until the row is hovered, and that same hover opens the
 * row's HoverCard preview. So the pointer opens the trigger and the keyboard
 * activates it — the one combination that is not a race with the preview.
 */
async function openDropdown(page: Page) {
	await row(page).hover();
	const trigger = page.locator('[data-slot="dropdown-menu-trigger"]').first();
	await expect(trigger).toBeVisible();
	await trigger.focus();
	await page.keyboard.press("Enter");
}

/** Open the right-click menu on the row. Forced past the same HoverCard preview,
 *  which a right-click has no reason to wait out. */
async function openContextMenu(page: Page) {
	await row(page).click({ button: "right", force: true });
}

/**
 * Labels of one menu's rows, in render order. Scoped to the menu's own popup
 * (`data-slot`) rather than a bare `[role="menuitem"]`: a dismissed dropdown can
 * outlive its close animation in the DOM, and an unscoped query would then read
 * both menus at once and "agree" with itself.
 */
async function menuLabels(
	page: Page,
	which: "context-menu" | "dropdown-menu"
): Promise<string[]> {
	const items = page.locator(
		`[data-slot="${which}-content"] [role="menuitem"]`
	);
	await expect(items.first()).toBeVisible();
	return (await items.allInnerTexts()).map((t) => t.trim());
}

test.describe("sidebar chat row — contributed rows on both menus", () => {
	test("the item preview clears the sidebar edge", async ({ page }) => {
		await page.goto(STORY_URL);
		await row(page).hover();

		const boundary = page.locator("[data-sidebar-preview-boundary]");
		const preview = page.locator('[data-slot="hover-card-content"]');
		await expect(preview).toBeVisible();

		const boundaryBox = await boundary.boundingBox();
		const previewBox = await preview.boundingBox();
		expect(boundaryBox).not.toBeNull();
		expect(previewBox).not.toBeNull();
		if (!(boundaryBox && previewBox)) {
			return;
		}
		expect(previewBox.x).toBeGreaterThanOrEqual(
			boundaryBox.x + boundaryBox.width + 7
		);
	});

	test("the hover preview lists the conversation message count", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		await row(page).hover();
		const preview = page.locator('[data-slot="hover-card-content"]');
		await expect(preview).toBeVisible();
		await expect(preview).toContainText("Messages");
		await expect(preview).toContainText("6");
	});

	test("the ⋯ dropdown lists the app-contributed rows", async ({ page }) => {
		await page.goto(STORY_URL);
		await openDropdown(page);
		const labels = await menuLabels(page, "dropdown-menu");
		expect(labels).toContain("Make a skill from this chat");
		expect(labels).toContain("Summarize this chat");
	});

	test("right-click lists the same app-contributed rows", async ({ page }) => {
		await page.goto(STORY_URL);
		await openContextMenu(page);
		const labels = await menuLabels(page, "context-menu");
		expect(labels).toContain("Make a skill from this chat");
		expect(labels).toContain("Summarize this chat");
		// Anchored: a `space` contribution must not reach a conversation menu.
		expect(labels).not.toContain("Space-only row");
	});

	test("both menus agree on contributed rows and their order", async ({
		page,
	}) => {
		await page.goto(STORY_URL);

		await openDropdown(page);
		const fromDropdown = (await menuLabels(page, "dropdown-menu")).filter((l) =>
			l.endsWith("this chat")
		);
		await page.keyboard.press("Escape");

		await openContextMenu(page);
		const fromContext = (await menuLabels(page, "context-menu")).filter((l) =>
			l.endsWith("this chat")
		);

		// `order: 10` before `order: 20`, identically on both surfaces.
		expect(fromDropdown).toEqual([
			"Make a skill from this chat",
			"Summarize this chat",
		]);
		expect(fromContext).toEqual(fromDropdown);
	});

	test("a contributed row in the right-click menu actually dispatches", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		await openContextMenu(page);
		await page
			.locator('[data-slot="context-menu-content"] [role="menuitem"]', {
				hasText: "Make a skill from this chat",
			})
			.click();
		await expect(page.getByTestId("invoked")).toHaveText(
			"@ryu/learning :: skill.fromChat :: conv-alpha"
		);
	});
});
