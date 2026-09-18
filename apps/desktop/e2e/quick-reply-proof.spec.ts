import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/quick-reply-proof.html";

function row(page: Page) {
	return page.getByTestId("sidebar-chat-row-conv-quick-reply");
}

async function openContextMenu(page: Page) {
	await row(page).click({ button: "right", force: true });
}

async function openDropdown(page: Page) {
	await row(page).hover();
	const trigger = page.locator('[data-slot="dropdown-menu-trigger"]').first();
	await expect(trigger).toBeVisible();
	await trigger.focus();
	await page.keyboard.press("Enter");
}

async function holdPreview(page: Page, target: ReturnType<typeof row>) {
	const bounds = await target.boundingBox();
	if (!bounds) {
		throw new Error("Quick preview row did not expose layout bounds");
	}
	await page.keyboard.down("Shift");
	await page.mouse.move(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	await page.mouse.down();
	await page.waitForTimeout(500);
	await expect(page.getByTestId("quick-preview")).toBeVisible();
	await page.mouse.up();
	await page.keyboard.up("Shift");
}

test("opens, resizes, sends, and marks a sidebar quick reply", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(STORY_URL);
	await expect(row(page)).toBeVisible();

	const composer = page.getByTestId("quick-reply-composer");
	await row(page).click({ modifiers: ["Alt"], force: true });
	await expect(composer).toBeVisible();
	await expect(page.getByTestId("selection-state")).toHaveText(
		"No chat selected"
	);
	await page.getByRole("button", { name: "Close quick reply" }).click();
	await expect(composer).not.toBeVisible();

	await openContextMenu(page);
	await expect(
		page.getByRole("menuitem", { name: "Quick reply", exact: true })
	).toBeVisible();
	await expect(
		page.getByRole("menuitem", { name: "Mark as unread", exact: true })
	).toBeVisible();
	await page
		.getByRole("menuitem", { name: "Quick reply", exact: true })
		.click();

	const textarea = composer.getByRole("textbox");
	await expect(composer).toBeVisible();
	await expect(textarea).toHaveAttribute(
		"placeholder",
		"Reply to Review the release notes…"
	);
	const before = await composer.boundingBox();
	await textarea.fill(
		"First line\nSecond line\nA quick follow-up for the session."
	);
	await expect(textarea).toHaveValue(
		"First line\nSecond line\nA quick follow-up for the session."
	);
	await page.waitForTimeout(100);
	const after = await composer.boundingBox();
	if (!(before && after)) {
		throw new Error("Quick reply composer did not expose layout bounds");
	}
	expect(after.height).toBeGreaterThan(before.height);
	await page.screenshot({
		path: "e2e/harness/quick-reply-proof.png",
		fullPage: true,
	});

	await composer.getByRole("button", { name: "Send" }).click();
	await expect(composer).not.toBeVisible();
	await expect(page.getByTestId("sent-reply")).toHaveText(
		"First line\nSecond line\nA quick follow-up for the session."
	);

	await holdPreview(page, row(page));
	const preview = page.getByTestId("quick-preview");
	await expect(preview).toContainText("Please keep the release notes review");
	await expect(preview).toContainText("The preview does not open the chat");
	await expect(page.getByTestId("selection-state")).toHaveText(
		"No chat selected"
	);
	await expect(page.getByTestId("unread-state")).toHaveText("Read");
	await preview.getByRole("button", { name: "Mark as unread" }).click();
	await expect(page.getByTestId("unread-state")).toHaveText("Unread");
	await expect(
		preview.getByRole("button", { name: "Mark as read" })
	).toBeVisible();
	await page.screenshot({
		path: "e2e/harness/quick-preview-proof.png",
		fullPage: true,
	});
	await page.getByRole("button", { name: "Close" }).click();
	await expect(preview).not.toBeVisible();
	await holdPreview(page, row(page));
	await expect(page.getByTestId("unread-state")).toHaveText("Unread");
	await expect(
		page.getByTestId("quick-preview").getByRole("button", {
			name: "Mark as read",
		})
	).toBeVisible();
	await preview.getByRole("button", { name: "Mark as read" }).click();
	await expect(page.getByTestId("unread-state")).toHaveText("Read");
	await page.getByRole("button", { name: "Close" }).click();
	await expect(preview).not.toBeVisible();

	await openContextMenu(page);
	await page
		.getByRole("menuitem", { name: "Mark as unread", exact: true })
		.click();
	await openContextMenu(page);
	await expect(
		page.getByRole("menuitem", { name: "Mark as read", exact: true })
	).toBeVisible();
	await page
		.getByRole("menuitem", { name: "Mark as read", exact: true })
		.click();

	await openDropdown(page);
	await expect(
		page.getByRole("menuitem", { name: "Quick reply", exact: true })
	).toBeVisible();
	await page
		.getByRole("menuitem", { name: "Quick reply", exact: true })
		.click();
	await expect(composer).toBeVisible();
	await page.getByRole("button", { name: "Close quick reply" }).click();
	await expect(composer).not.toBeVisible();
	await expect(errors).toEqual([]);
});
