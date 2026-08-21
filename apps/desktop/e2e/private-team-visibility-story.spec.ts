import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const PROOF_SCREENSHOT =
	process.env.RYU_VISIBILITY_PROOF_SCREENSHOT ??
	"/tmp/ryu-private-team-visibility-proof.png";

function chatRow(page: import("@playwright/test").Page, title: string) {
	return page.locator('div[role="button"]', { hasText: title }).first();
}

test("private and team scopes show pages, chats, and the visibility action", async ({
	page,
}) => {
	await page.setViewportSize({ height: 900, width: 1200 });
	await page.goto("/private-team-visibility-story.html");
	await expect(page.getByText("Private", { exact: true })).toBeVisible();
	await expect(page.getByText("Team", { exact: true })).toBeVisible();
	await expect(page.getByText("Personal notes", { exact: true })).toBeVisible();
	await expect(page.getByText("Team knowledge", { exact: true })).toBeVisible();
	await expect(page.getByText("Private prompt", { exact: true })).toBeVisible();
	await expect(page.getByText("Team roadmap", { exact: true })).toBeVisible();

	const teamSpace = page.locator('[role="button"]', {
		hasText: "Team knowledge",
	});
	await teamSpace.click();
	await expect(page.getByText("Launch brief", { exact: true })).toBeVisible();
	await expect(page.getByText("Meeting notes", { exact: true })).toBeVisible();

	const privateChat = chatRow(page, "Private prompt");
	await privateChat.hover();
	const menuTrigger = privateChat.locator(
		'[data-slot="dropdown-menu-trigger"]'
	);
	await expect(menuTrigger).toBeVisible();
	await menuTrigger.focus();
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("menuitem", { name: "Share with team", exact: true })
	).toBeVisible();
	await page
		.getByRole("menuitem", { name: "Share with team", exact: true })
		.click();
	await expect(
		page.getByRole("alertdialog").getByText("Share with your team?", {
			exact: true,
		})
	).toBeVisible();
	await expect(
		page.getByRole("alertdialog").getByText(/will become visible to everyone/i)
	).toBeVisible();
	await page
		.getByRole("button", { name: "Share with team", exact: true })
		.click();

	await expect(page.getByTestId("status")).toHaveText(
		"Chat shared with the team"
	);
	await expect(page.getByText("Private prompt", { exact: true })).toBeVisible();
	await expect(page.getByText("Team roadmap", { exact: true })).toBeVisible();

	await chatRow(page, "Team roadmap").dragTo(
		page.locator('[data-subsection-key="private"]')
	);
	await expect(
		page.getByRole("alertdialog").getByText("Make this private?", {
			exact: true,
		})
	).toBeVisible();
	await expect(
		page
			.getByRole("alertdialog")
			.getByText(/no longer be accessible to the team/i)
	).toBeVisible();
	await page.getByRole("button", { name: "Make private", exact: true }).click();
	await expect(page.getByTestId("status")).toHaveText("Chat made private");
	await expect(page.getByRole("alertdialog")).toBeHidden();

	await page.screenshot({ path: PROOF_SCREENSHOT, fullPage: true });
});

test("dragging a private chat to Team requires sharing confirmation", async ({
	page,
}) => {
	await page.goto("/private-team-visibility-story.html");

	await chatRow(page, "Private prompt").dragTo(
		page.locator('[data-subsection-key="team"]')
	);
	await expect(
		page.getByRole("alertdialog").getByText("Share with your team?", {
			exact: true,
		})
	).toBeVisible();
	await expect(
		page.getByRole("alertdialog").getByText(/will become visible to everyone/i)
	).toBeVisible();
	await page
		.getByRole("button", { name: "Share with team", exact: true })
		.click();

	await expect(page.getByTestId("status")).toHaveText(
		"Chat shared with the team"
	);
	await expect(page.getByRole("alertdialog")).toBeHidden();
});
