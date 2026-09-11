import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("long transcripts defer offscreen layout while the newest turn stays live", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/chat-scroll-story.html");
	await expect(page.getByTestId("story-state")).toHaveAttribute(
		"data-message-count",
		"80",
		{ timeout: 60_000 }
	);
	const rows = page.locator("[data-slot=message-scroller-item]");
	await expect(rows).toHaveCount(40);
	expect(
		await rows
			.first()
			.evaluate((element) => getComputedStyle(element).contentVisibility)
	).toBe("auto");
	expect(
		await rows
			.last()
			.evaluate((element) => getComputedStyle(element).contentVisibility)
	).toBe("visible");
	await expect
		.poll(
			async () =>
				await rows.evaluateAll(
					(elements) =>
						elements.slice(0, -1).filter((element) => {
							const child = element.querySelector("p");
							return (
								child && !child.checkVisibility({ contentVisibilityAuto: true })
							);
						}).length
				)
		)
		.toBeGreaterThan(0);
	await rows.first().scrollIntoViewIfNeeded();
	await expect(
		page.getByText("Question 0 about the codebase", { exact: true })
	).toBeVisible();
	await rows.last().scrollIntoViewIfNeeded();
	await expect(
		page.getByText("Question 39 about the codebase", { exact: true })
	).toBeVisible();
	expect(errors).toEqual([]);
	const directory = path.resolve(
		import.meta.dirname,
		"../../../docs/proof/performance-sweep"
	);
	await mkdir(directory, { recursive: true });
	await page.screenshot({
		path: path.join(directory, "chat-completed.png"),
		fullPage: true,
	});
});
