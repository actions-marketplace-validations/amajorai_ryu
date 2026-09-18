import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/connection-status-proof.html";

test("connection states keep the workspace mounted and recover in place", async ({
	page,
}, testInfo) => {
	await page.goto(STORY_URL);

	const proof = page.getByTestId("connection-status-proof");
	const toast = page.getByTestId("connection-status-toast");
	const surface = toast.locator('[data-slot="connection-status-surface"]');
	await expect(proof).toHaveAttribute("data-harness-ready", "1");
	await expect(toast).toHaveAttribute(
		"data-connection-phase",
		"node-unreachable"
	);
	await expect(surface).toBeVisible();
	await expect(
		surface.locator('[data-slot="connection-status-title"]')
	).toHaveText("Node offline");
	await expect(
		surface.locator('[data-slot="connection-status-detail"]')
	).toContainText("Can’t reach Design node");
	await expect(toast).toContainText("Node offline");
	await expect(toast).toContainText("Can’t reach Design node");
	await expect(toast.getByRole("button", { name: "Retry" })).toBeVisible();
	const retryGeometry = await toast
		.getByRole("button", { name: "Retry" })
		.evaluate((element) => {
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			return {
				cornerShape: style.getPropertyValue("corner-shape"),
				height: Math.round(rect.height),
				width: Math.round(rect.width),
			};
		});
	expect(retryGeometry.width).toBe(retryGeometry.height);
	expect(["round", "superellipse(1)"]).toContain(retryGeometry.cornerShape);
	await page.screenshot({
		path: testInfo.outputPath("connection-status-pill-proof.png"),
	});

	await page.getByRole("button", { name: "Simulate no Wi-Fi" }).click();
	await expect(toast).toHaveAttribute("data-connection-phase", "offline");
	await expect(toast).toContainText("Offline mode");
	await expect(toast).toContainText("Waiting for connectivity");
	await expect(toast.getByRole("button", { name: "Retry" })).toHaveCount(0);

	await page.getByRole("button", { name: "Confirm restored" }).click();
	await expect(toast).toHaveAttribute("data-connection-phase", "online");
	await expect(toast).toHaveAttribute("data-connection-restored", "true");
	await expect(toast).toContainText("Connection restored");

	await page.getByRole("button", { name: "Reconnect" }).click();
	await expect(toast).toHaveAttribute("data-connection-phase", "checking");
	await expect(toast).toContainText("Connecting to Design node");
});
