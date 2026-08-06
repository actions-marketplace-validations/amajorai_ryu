// Real-browser spec for the tab-entity-menu story (`e2e/harness/
// tab-entity-menu-story.{html,tsx}`), which mounts the REAL
// `TabEntityMenuSection` inside a real `ContextMenu` against a stubbed
// `/api/plugins/contributions` carrying two rows on two different anchors.
//
// What it certifies, none of which a type-check can see:
//   • the section is anchor-scoped — the chat tab gets the `conversation` row and
//     never the `space` one, and the reverse for the space tab;
//   • app rows are rendered from the payload alone, so an app adds a tab-menu row
//     by declaring `contributes.context_menu_items`, with no shell change;
//   • the shell built-in is live: "Pin chat" flips to "Unpin chat" through the
//     shared conversation-flags store;
//   • a contributed row dispatches with the id keyed BY ANCHOR — a space row is
//     handed `space_id`, not the `conversation_id` its capability would ignore;
//   • a tab that shows no entity renders no section (and no stray separator).

import { expect, type Page, test } from "@playwright/test";

// The story pulls the sidebar/context-menu module graph; vite compiles it on
// first navigation, so allow headroom over the 30s default for cold-start runs.
test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/tab-entity-menu-story.html";

/** Right-click a pill and wait for its menu to be on screen. */
async function openMenu(page: Page, tabId: string) {
	await page.getByTestId(`pill-${tabId}`).click({ button: "right" });
	await expect(page.getByRole("menuitem", { name: "Pin tab" })).toBeVisible();
}

test.describe("tab entity menu — real section in isolation", () => {
	test("shows the chat's own verbs plus only the conversation-anchored app row", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		await openMenu(page, "tab-chat");

		await expect(
			page.getByRole("menuitem", { name: "Pin chat" })
		).toBeVisible();
		await expect(
			page.getByRole("menuitem", { name: "Mark as unread" })
		).toBeVisible();
		await expect(
			page.getByRole("menuitem", { name: "Archive chat" })
		).toBeVisible();
		await expect(
			page.getByRole("menuitem", { name: "Make a skill from this chat" })
		).toBeVisible();
		// Declared for `anchor: "space"` — must not leak into a chat tab.
		await expect(
			page.getByRole("menuitem", { name: "Publish this space" })
		).toHaveCount(0);
	});

	test("shows the space-anchored app row, and no chat-only verbs, on a space tab", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		await openMenu(page, "tab-space");

		await expect(
			page.getByRole("menuitem", { name: "Publish this space" })
		).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "Pin chat" })).toHaveCount(
			0
		);
		await expect(
			page.getByRole("menuitem", { name: "Make a skill from this chat" })
		).toHaveCount(0);
	});

	test("renders nothing for a tab that shows no entity", async ({ page }) => {
		await page.goto(STORY_URL);
		await openMenu(page, "tab-settings");

		await expect(
			page.getByRole("menuitem", { name: "Close tab" })
		).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "Pin chat" })).toHaveCount(
			0
		);
		await expect(
			page.getByRole("menuitem", { name: "Publish this space" })
		).toHaveCount(0);
	});

	test("pinning the chat flips the label through the shared store", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		await openMenu(page, "tab-chat");
		await page.getByRole("menuitem", { name: "Pin chat" }).click();

		await openMenu(page, "tab-chat");
		await expect(
			page.getByRole("menuitem", { name: "Unpin chat" })
		).toBeVisible();
	});

	test("a contributed row dispatches with the id keyed by its anchor", async ({
		page,
	}) => {
		await page.goto(STORY_URL);

		await openMenu(page, "tab-chat");
		await page
			.getByRole("menuitem", { name: "Make a skill from this chat" })
			.click();
		const chatDispatch = page.getByTestId("dispatched");
		await expect(chatDispatch).toContainText("@ryu/learning");
		await expect(chatDispatch).toContainText('"conversation_id":"conv-1"');
		await expect(chatDispatch).toContainText('"method":"skill.create"');

		await openMenu(page, "tab-space");
		await page.getByRole("menuitem", { name: "Publish this space" }).click();
		const spaceDispatch = page.getByTestId("dispatched");
		await expect(spaceDispatch).toContainText("@example/publisher");
		// The anchor-keyed payload: a space row must NOT be handed conversation_id.
		await expect(spaceDispatch).toContainText('"space_id":"space-1"');
		await expect(spaceDispatch).not.toContainText("conversation_id");
	});
});
