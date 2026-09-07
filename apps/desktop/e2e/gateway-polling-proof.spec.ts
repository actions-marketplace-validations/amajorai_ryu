import { expect, test } from "@playwright/test";

test("gateway status polling follows dialog lifetime", async ({
	page,
}, testInfo) => {
	test.setTimeout(120_000);
	const browserErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	await page.goto("/settings-dialog-shortcuts-proof.html");
	await expect(page.locator("body")).toHaveAttribute(
		"data-hotkeys-ready",
		"true"
	);
	const requests = () =>
		page.evaluate(() => Number(document.body.dataset.gatewayRequests ?? "0"));
	// Observe more than a full polling period to catch timers in closed dialogs.
	await page.waitForTimeout(5500);
	const closedRequests = await requests();
	await testInfo.attach("closed-request-count", {
		body: JSON.stringify({ durationMs: 5500, requests: closedRequests }),
		contentType: "application/json",
	});
	expect(closedRequests).toBe(0);
	await page.keyboard.press("Control+,");
	const dialog = page.locator('[data-slot="dialog-content"]');
	await expect(
		dialog.getByRole("heading", { name: "Overview", exact: true })
	).toBeVisible();
	await expect.poll(requests).toBeGreaterThan(closedRequests);
	const openedRequests = await requests();
	await expect
		.poll(requests, { timeout: 8000 })
		.toBeGreaterThan(openedRequests);
	await page.screenshot({
		path: testInfo.outputPath("gateway-polling-product.png"),
		fullPage: true,
	});
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
	const atClose = await requests();
	await page.waitForTimeout(5500);
	const afterClose = await requests();
	await page.keyboard.press("Control+,");
	await expect(dialog).toBeVisible();
	await expect.poll(requests).toBeGreaterThan(afterClose);
	await testInfo.attach("request-counts", {
		body: JSON.stringify(
			{
				closedRequests,
				openedRequests,
				atClose,
				afterClose,
				reopenedRequests: await requests(),
			},
			null,
			2
		),
		contentType: "application/json",
	});
	expect(afterClose).toBe(atClose);
	expect(browserErrors).toEqual([]);
});
