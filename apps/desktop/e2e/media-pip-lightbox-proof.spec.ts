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
	await dock.locator('[data-media-pip-preview="true"]').click();
	const recording = page.getByRole("dialog", {
		name: "Evidence recording fullscreen",
	});
	await expect(recording).toBeVisible();
	await expect
		.poll(() =>
			recording.locator("video").evaluate((video) => video.videoWidth)
		)
		.toBe(960);
	await page
		.getByRole("button", { name: "Close fullscreen media", exact: true })
		.focus();
	await page.keyboard.press("Tab");
	await expect
		.poll(() =>
			recording.evaluate((element) => element.contains(document.activeElement))
		)
		.toBe(true);
	await expect
		.poll(() =>
			recording.locator("video").evaluate((video) => {
				const transform = getComputedStyle(
					video.parentElement ?? video
				).transform;
				if (transform === "none") {
					return true;
				}
				const matrix = new DOMMatrixReadOnly(transform);
				return (
					Math.abs(matrix.e) < 0.5 &&
					Math.abs(matrix.f) < 0.5 &&
					Math.abs(matrix.a - 1) < 0.005
				);
			})
		)
		.toBe(true);
	await page.screenshot({
		path: "../../../artifacts/ui-design-audit/screenshots/recording-lightbox-verified.png",
	});
	await page.keyboard.press("Escape");
	await expect(recording).toBeHidden();
	await expect(dock.locator('[data-media-pip-preview="true"]')).toBeFocused();
});
