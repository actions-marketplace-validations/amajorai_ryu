import { expect, test } from "@playwright/test";

const STORY_URL = "/select-trigger-proof.html";

test("defaults SelectTrigger to transparent ghost styling and fills on hover", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	const ghostTrigger = page.getByTestId("ghost-trigger");
	const filledTrigger = page.getByTestId("filled-trigger");

	const restingBackground = await ghostTrigger.evaluate(
		(element) => getComputedStyle(element).backgroundColor
	);
	const filledBackground = await filledTrigger.evaluate(
		(element) => getComputedStyle(element).backgroundColor
	);

	expect(restingBackground).toBe("rgba(0, 0, 0, 0)");
	expect(filledBackground).not.toBe(restingBackground);

	await ghostTrigger.hover();

	await expect
		.poll(() =>
			ghostTrigger.evaluate((element) => ({
				background: getComputedStyle(element).backgroundColor,
				hovered: element.matches(":hover"),
			}))
		)
		.toEqual({
			background: expect.not.stringMatching(/^rgba\(0, 0, 0, 0\)$/),
			hovered: true,
		});
});
