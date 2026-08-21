import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/scroll-fade-story.html";

test("renders the shared shadcn scroll fade and responds to scrolling", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	const scroller = page.getByTestId("scroll-fade-scroller");
	await expect(scroller).toBeVisible();
	await expect
		.poll(() =>
			scroller.evaluate((element) => ({
				animationName: getComputedStyle(element).animationName,
				animationTimeline: getComputedStyle(element)
					.getPropertyValue("animation-timeline")
					.trim(),
				className: element.className,
				clientHeight: element.clientHeight,
				maskImage: getComputedStyle(element).maskImage,
				scrollHeight: element.scrollHeight,
			}))
		)
		.toMatchObject({
			animationName: expect.stringContaining("scroll-fade-reveal"),
			animationTimeline: expect.stringContaining("scroll"),
			className: expect.stringContaining("scroll-fade"),
			maskImage: expect.stringContaining("linear-gradient"),
		});

	const beforeScroll = await scroller.evaluate((element) => ({
		clientHeight: element.clientHeight,
		scrollHeight: element.scrollHeight,
	}));
	expect(beforeScroll.scrollHeight).toBeGreaterThan(beforeScroll.clientHeight);
	expect(await scroller.evaluate((element) => element.className)).not.toContain(
		"scroll-fade-effect-y"
	);

	await scroller.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
		element.dispatchEvent(new Event("scroll"));
	});
	await expect(page.getByTestId("proof-status")).toHaveAttribute(
		"data-status",
		"pass"
	);
	await expect(page.getByTestId("scroll-position")).not.toHaveText("0px");
});
