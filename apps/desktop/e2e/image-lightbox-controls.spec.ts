import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("shows the image title, download action, and bottom zoom control", async ({
	page,
}) => {
	await page.goto("media-pip-lightbox-proof.html", {
		waitUntil: "domcontentloaded",
	});

	const dock = page.locator('[data-media-pip-dock="true"]');
	await expect(dock).toBeVisible();
	await page.getByTestId("source-desktop").click();
	await dock.locator('[data-media-pip-preview="true"]').click();

	const lightbox = page.getByRole("dialog");
	await expect(lightbox).toBeVisible();

	const title = lightbox.getByText("Remote node desktop", { exact: true });
	const zoomOut = lightbox.getByRole("button", { name: "Zoom out" });
	const zoomIn = lightbox.getByRole("button", { name: "Zoom in" });
	const download = lightbox.getByRole("link", {
		name: "Download Remote node desktop",
	});

	await expect(title).toBeVisible();
	await expect(lightbox.getByText("100%", { exact: true })).toBeVisible();
	await expect(zoomOut).toBeDisabled();
	await expect(zoomIn).toBeEnabled();
	await expect(download).toHaveAttribute("download", "Remote node desktop");

	const titleBox = await title.boundingBox();
	const zoomBox = await lightbox
		.getByText("100%", { exact: true })
		.boundingBox();
	expect(titleBox).not.toBeNull();
	expect(zoomBox).not.toBeNull();
	if (titleBox && zoomBox) {
		expect(zoomBox.y).toBeGreaterThan(titleBox.y + titleBox.height);
	}

	const downloadPromise = page.waitForEvent("download");
	await download.click();
	const downloaded = await downloadPromise;
	expect(downloaded.suggestedFilename()).toBe("Remote node desktop.svg");

	await page.screenshot({
		fullPage: true,
		path: "test-results/image-lightbox-controls-proof.png",
	});

	await zoomIn.click();
	await expect(lightbox.getByText("125%", { exact: true })).toBeVisible();
	await expect(zoomOut).toBeEnabled();

	await zoomOut.click();
	await expect(lightbox.getByText("100%", { exact: true })).toBeVisible();
	await lightbox.getByRole("button", { name: "Close" }).click();
	await expect(lightbox).toHaveCount(0);
});
