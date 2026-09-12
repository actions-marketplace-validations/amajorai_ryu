import { expect, test } from "@playwright/test";

test("production composer preserves mention targeting, references, focus and submitted text", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.goto("/refactor-composer-proof.html");
	const input = page.locator("textarea");
	await expect(input).toBeVisible();
	await input.fill("@Rev");
	await page.getByRole("option", { name: /Reviewer/ }).click();
	await expect(input).toBeFocused();
	await expect(input).toHaveValue("@Reviewer ");
	await input.fill("@Reviewer review @Project plan");
	await input.press("Enter");
	await expect(page.getByTestId("submitted-request")).toHaveText(
		JSON.stringify({
			content: "@Reviewer review @Project plan",
			agentId: "reviewer",
			references: ["project-plan"],
		})
	);
	await expect(input).toHaveValue("");
	await input.pressSequentially("Keep the existing behavior", { delay: 15 });
	await expect(input).toBeFocused();
	await expect(input).toHaveValue("Keep the existing behavior");
	expect(errors).toEqual([]);
	await page.screenshot({
		path: testInfo.outputPath("composer-completed.png"),
		fullPage: true,
	});
});

test("slash commands and narrow layout stay usable", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 720, height: 820 });
	await page.goto("/refactor-composer-proof.html");
	const input = page.locator("textarea");
	await input.fill("/go");
	await page.getByRole("option", { name: /goal/ }).click();
	await expect(input).toBeFocused();
	await expect(input).toHaveValue(/\/goal/);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth
		)
	).toBe(true);
	await page.screenshot({
		path: testInfo.outputPath("composer-narrow.png"),
		fullPage: true,
	});
});
