import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("renders the target-aware cursor and proves its idle fade", async ({
	page,
}) => {
	await page.goto("/ghost-cursor-proof.html");

	await expect(page.getByTestId("ghost-cursor-proof")).toBeVisible();
	await expect(page.getByTestId("ghost-intent-label")).toHaveText(
		/Click “Send”/
	);
	await expect(page.getByTestId("ghost-cursor-state")).toHaveText(/Visible/);

	await page.getByTestId("ghost-cursor-replay").click();
	await expect(page.getByTestId("ghost-cursor-state")).toHaveText(/Visible/);
	await expect(page.getByTestId("ghost-cursor-marker")).toHaveCSS(
		"opacity",
		"0.68"
	);

	await expect(page.getByTestId("ghost-cursor-state")).toHaveText(
		/Faded after 2.4s idle/,
		{ timeout: 4000 }
	);
});
