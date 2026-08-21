import { expect, test } from "@playwright/test";

const STORY_URL = "/notification-layout-proof.html";

test("proves the appearance slider switches between split, grouped, and unified", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	const slider = page.getByRole("slider", { name: "Notification layout" });
	await expect(page.getByTestId("notification-layout-value")).toHaveText(
		"Unified"
	);
	await expect(page.getByTestId("notification-surface")).toBeVisible();
	await expect(page.getByTestId("announcement-surface")).toHaveCount(0);

	await slider.press("Home");
	await expect(page.getByTestId("notification-layout-value")).toHaveText(
		"Split"
	);
	await expect(page.getByTestId("announcement-surface")).toBeVisible();
	await expect(page.getByTestId("inbox-surface")).toBeVisible();
	await expect(page.getByTestId("notification-surface")).toHaveCount(0);

	await slider.press("ArrowRight");
	await expect(page.getByTestId("notification-layout-value")).toHaveText(
		"Grouped"
	);
	await expect(page.getByTestId("notification-surface")).toBeVisible();
	await expect(page.getByTestId("announcement-surface")).toHaveCount(0);

	await slider.press("End");
	await expect(page.getByTestId("notification-layout-value")).toHaveText(
		"Unified"
	);
	await expect(page.getByTestId("mode-unified")).toHaveClass(/border-primary/);
});

test("proves the stack expands and keeps card actions clickable", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	const slider = page.getByRole("slider", { name: "Notification layout" });
	await slider.press("End");
	const stack = page.getByTestId("notification-surface");
	const expand = stack.getByRole("button", {
		name: /notifications\. expand notifications/i,
	});
	await expand.click();
	await expect(stack.getByText("Appearance update").last()).toBeVisible();

	await stack
		.getByRole("button", { name: "Mark Appearance update read" })
		.click();
	await expect(page.getByTestId("proof-status")).toHaveText(
		"Marked Appearance update read"
	);
});
