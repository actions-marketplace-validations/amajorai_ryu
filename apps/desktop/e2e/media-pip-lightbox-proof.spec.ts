import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("follows the selected source and morphs the live frame into a lightbox", async ({
	page,
}) => {
	await page.goto("/media-pip-lightbox-proof.html", {
		waitUntil: "domcontentloaded",
	});

	const dock = page.locator('[data-media-pip-dock="true"]');
	await expect(dock).toBeVisible();
	await expect(dock).toContainText("Agent Browser");
	await expect(page.getByTestId("proof-active-source")).toHaveText(
		"Agent Browser active tab"
	);

	await page.getByTestId("source-desktop").click();
	await expect(dock).toContainText("Remote desktop");
	await expect(page.getByTestId("proof-active-source")).toHaveText(
		"Remote node desktop"
	);

	await dock.locator('[data-media-pip-preview="true"]').click();
	const lightbox = page.getByRole("dialog");
	await expect(lightbox).toBeVisible();
	await expect(
		lightbox.locator('img[alt="Remote node desktop"]')
	).toBeVisible();
	await page.screenshot({
		fullPage: true,
		path: "test-results/media-pip-lightbox-proof.png",
	});

	await page.keyboard.press("Escape");
	await expect(lightbox).toHaveCount(0);

	await page.getByTestId("source-recording").click();
	await expect(dock).toContainText("Evidence recording");
	await expect(dock).toContainText("Recording is ready");
});
