import { expect, test } from "@playwright/test";

const STORY_URL = "/proactive-channel-opening-proof.html";

test("shows the plain-language proactive channel opening controls", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	await page.waitForSelector("body[data-harness-ready='1']");

	await expect(page.getByText("Say hello first")).toBeVisible();
	await expect(
		page.getByText(
			"Let Ryu introduce itself and ask what to do next when this bot is ready."
		)
	).toBeVisible();
	await expect(page.getByLabel("Where should Ryu say hello?")).toBeVisible();
	await expect(
		page.getByPlaceholder("The approved chat address or phone number")
	).toBeVisible();

	await page.screenshot({
		path: test.info().outputPath("proactive-channel-opening-proof.png"),
		fullPage: true,
	});
});
