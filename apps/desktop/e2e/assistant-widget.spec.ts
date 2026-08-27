import { expect, test } from "@playwright/test";

test("renders the shared floating assistant primitive", async ({
	page,
}, testInfo) => {
	await page.goto("/assistant-widget-story.html");

	const frame = page.getByTestId("assistant-widget-proof");
	await expect(frame).toBeVisible();
	await expect(page.getByTestId("assistant-widget-header")).toBeVisible();
	await expect(frame.getByTestId("ryu-assistant-recent-chats")).toBeVisible();
	await expect(frame.getByText("Help request", { exact: true })).toBeVisible();
	await expect(frame.getByPlaceholder("Send a message")).toBeVisible();
	await expect(
		frame.getByRole("button", { name: "Close assistant" })
	).toBeVisible();
	await page.waitForTimeout(700);

	const geometry = await frame.evaluate((element) => {
		const dialog = element.querySelector('[role="dialog"]');
		return {
			height: dialog?.getBoundingClientRect().height ?? 0,
			width: dialog?.getBoundingClientRect().width ?? 0,
		};
	});
	expect(geometry.width).toBe(400);
	expect(geometry.height).toBe(620);

	await page.screenshot({
		path: testInfo.outputPath("assistant-widget-floating-proof.png"),
	});

	await frame.getByRole("button", { name: "Help request" }).click();
	await expect(page.getByTestId("selected-chat")).toHaveText("help");
});
