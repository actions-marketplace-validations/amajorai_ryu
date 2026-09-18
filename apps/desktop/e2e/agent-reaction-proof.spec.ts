import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("renders the reaction on a peer-agent message", async ({
	page,
}, testInfo) => {
	await page.goto("/agent-reaction-proof.html");

	await expect(page.getByTestId("agent-reaction-proof")).toBeVisible();
	await expect(page.getByTestId("agent-message-bubble")).toContainText(
		"Beta Agent"
	);
	await expect(page.getByTestId("agent-message-bubble")).toContainText(
		"The deployment is healthy"
	);
	await expect(page.getByTestId("reaction-contract")).toContainText(
		"agents.react"
	);
	await expect(page.getByTestId("reaction-contract")).toContainText(
		"Accepted by Core"
	);

	await page.getByTestId("agent-message-bubble").hover();
	const peerToolbar = page.locator('[data-slot="message-toolbar"]').last();
	await expect(
		peerToolbar.getByRole("button", { name: "Add reaction" })
	).toBeVisible();
	await peerToolbar.getByRole("button", { name: "Add reaction" }).click();
	await expect(page.getByRole("button", { name: "✅ 1" })).toBeVisible();
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("agent-reaction-proof.png"),
	});
});
