import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/dropdown-picker-proof.html";

test("proves dropdown scale-fade lifecycle and measured scroll fades", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	await page.route("**/api/providers/**/credits", (route) =>
		route.fulfill({
			body: JSON.stringify({
				available: false,
				meters: [],
				provider_id: "openrouter",
				reason: null,
				retry_after_seconds: null,
			}),
			contentType: "application/json",
			status: 200,
		})
	);
	await page.setViewportSize({ height: 900, width: 1440 });
	await page.goto(STORY_URL);

	const longTrigger = page.getByTestId("dropdown-proof-trigger");
	await longTrigger.click();
	const longMenu = page.getByTestId("dropdown-proof-menu");
	await expect(longMenu).toBeVisible();
	await expect(longMenu).toHaveAttribute("data-origin", "top-left");
	await expect
		.poll(() =>
			longMenu.evaluate((element) => element.classList.contains("is-open"))
		)
		.toBe(true);
	await expect(longMenu).toHaveAttribute("data-scroll-edges", "bottom");
	await page.waitForTimeout(700);
	const longMetrics = await longMenu.evaluate((element) => ({
		clientHeight: element.clientHeight,
		maskImage: getComputedStyle(element).maskImage,
		scrollHeight: element.scrollHeight,
	}));
	expect(longMetrics.scrollHeight).toBeGreaterThan(longMetrics.clientHeight);
	expect(longMetrics.maskImage).toContain("linear-gradient");
	await page.screenshot({
		path: "test-results/dropdown-scroll-fade-long-proof.png",
	});

	await page.keyboard.press("Escape");
	const shortTrigger = page.getByTestId("dropdown-short-trigger");
	await shortTrigger.click();
	const shortMenu = page.getByTestId("dropdown-short-menu");
	await expect(shortMenu).toBeVisible();
	await expect(shortMenu).toHaveAttribute("data-origin", "top-left");
	await expect(shortMenu).toHaveAttribute("data-scroll-edges", "none");
	await page.waitForTimeout(700);
	const shortMetrics = await shortMenu.evaluate((element) => ({
		clientHeight: element.clientHeight,
		maskImage: getComputedStyle(element).maskImage,
		scrollHeight: element.scrollHeight,
	}));
	expect(shortMetrics.scrollHeight).toBeLessThanOrEqual(
		shortMetrics.clientHeight
	);
	expect(shortMetrics.maskImage).not.toContain("linear-gradient");
	await page.screenshot({
		path: "test-results/dropdown-scroll-fade-short-proof.png",
	});

	await page.keyboard.press("Escape");
	const closingShortMenu = page.locator(
		'[data-testid="dropdown-short-menu"].is-closing'
	);
	await expect(closingShortMenu).toHaveCount(1);
	const closingTransitionDuration = await closingShortMenu.evaluate(
		(element) => getComputedStyle(element).transitionDuration
	);
	expect(closingTransitionDuration).toContain("0.15s");
	await expect(shortMenu).toHaveCount(0);
	await shortTrigger.click();
	await page.waitForTimeout(45);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(45);
	await shortTrigger.click();
	await page.waitForTimeout(700);
	const settled = await shortMenu.evaluate((element) => {
		const transform = getComputedStyle(element).transform;
		const matrix =
			transform === "none" ? null : new DOMMatrixReadOnly(transform);
		return {
			className: element.className,
			height: element.getBoundingClientRect().height,
			open: element.hasAttribute("data-open"),
			origin: element.getAttribute("data-origin"),
			opacity: getComputedStyle(element).opacity,
			scaleX: matrix?.a ?? 1,
			scaleY: matrix?.d ?? 1,
			transitionDuration: getComputedStyle(element).transitionDuration,
			transform,
			width: element.getBoundingClientRect().width,
		};
	});
	expect(settled.open).toBe(true);
	expect(settled.className).toContain("t-dropdown");
	expect(settled.className).toContain("is-open");
	expect(settled.origin).toBe("top-left");
	expect(settled.opacity).toBe("1");
	expect(settled.transitionDuration).toContain("0.25s");
	expect(settled.width).toBeGreaterThan(0);
	expect(settled.height).toBeGreaterThan(0);
	expect(settled.scaleX).toBeGreaterThan(0.99);
	expect(settled.scaleY).toBeGreaterThan(0.99);
	await page.screenshot({
		path: "test-results/dropdown-scale-fade-settled-proof.png",
		fullPage: true,
	});

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});
