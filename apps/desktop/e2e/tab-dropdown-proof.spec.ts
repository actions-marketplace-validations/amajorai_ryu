import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("proves the default searchable dropdown tab switcher", async ({
	page,
}, testInfo) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await page.goto("/tab-dropdown-proof.html");

	const setting = page.getByTestId("tab-dropdown-setting");
	await expect(setting).toHaveAttribute("aria-checked", "true");

	const trigger = page.getByRole("button", { name: "Open tabs" });
	await expect(trigger).toBeVisible();
	const idleMetrics = await trigger.evaluate((element) => {
		const styles = getComputedStyle(element);
		return {
			background: styles.backgroundColor,
			borderWidth: styles.borderTopWidth,
			outline: styles.outlineStyle,
			transition: styles.transitionDuration,
		};
	});
	expect(idleMetrics.background).toBe("rgba(0, 0, 0, 0)");
	expect(idleMetrics.borderWidth).toBe("0px");
	expect(idleMetrics.outline).toBe("none");
	expect(idleMetrics.transition).not.toBe("0s");

	await trigger.hover();
	const hoverBackground = await trigger.evaluate(
		(element) => getComputedStyle(element).backgroundColor
	);
	expect(hoverBackground).not.toBe(idleMetrics.background);

	await trigger.click();
	const search = page.getByPlaceholder("Search open tabs…");
	await expect(search).toBeVisible();
	await expect(page.getByRole("option")).toHaveCount(4);

	await search.fill("spaces/research");
	await expect(page.getByRole("option")).toHaveCount(1);
	await page
		.getByRole("option")
		.getByText("Research notes", { exact: true })
		.click();
	await expect(page.getByTestId("active-tab")).toHaveText("Research notes");

	await trigger.click();
	await expect(search).toHaveValue("");
	await page
		.getByRole("button", {
			name: "Close Long-running customer research plan",
		})
		.click();

	await setting.click();
	await expect(page.getByTestId("full-tab-strip-fallback")).toBeVisible();
	await expect(trigger).toHaveCount(0);
	await setting.click();
	await expect(trigger).toBeVisible();

	await trigger.click();
	await expect(search).toBeVisible();
	await expect(page.getByTestId("proof-status")).toHaveAttribute(
		"data-proof-status",
		"pass"
	);
	await page.waitForTimeout(300);
	await page.screenshot({
		path: testInfo.outputPath("tab-dropdown-proof.png"),
		fullPage: true,
	});

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});
