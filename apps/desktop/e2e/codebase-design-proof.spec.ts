import { expect, type Page, test } from "@playwright/test";

async function waitForVisualState(page: Page) {
	await page.evaluate(async () => {
		await document.fonts.ready;
		const finite = document
			.getAnimations()
			.filter(
				(animation) =>
					animation.effect?.getComputedTiming().iterations !==
					Number.POSITIVE_INFINITY
			);
		await Promise.all(
			finite.map((animation) => animation.finished.catch(() => undefined))
		);
	});
}

for (const theme of ["light", "dark"]) {
	test(`shared confirmations support cancel, Escape, focus restoration and approval in ${theme}`, async ({
		page,
	}) => {
		let nativeDialogs = 0;
		page.on("dialog", (dialog) => {
			nativeDialogs += 1;
			void dialog.dismiss();
		});
		await page.goto(`/codebase-design-proof.html?theme=${theme}`);
		const trigger = page.getByRole("button", {
			name: "Confirm sample action",
			exact: true,
		});
		const modal = page.getByRole("alertdialog");
		await trigger.click();
		await expect(modal).toContainText("Run the sample action?");
		await expect(
			page.getByRole("button", { name: "Cancel", exact: true })
		).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(
			page.getByRole("button", { name: "Run action", exact: true })
		).toBeFocused();
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(modal).toBeHidden();
		await expect(trigger).toBeFocused();
		await expect(page.getByRole("status")).toHaveText("Action cancelled");
		await trigger.click();
		await page.keyboard.press("Escape");
		await expect(modal).toBeHidden();
		await expect(trigger).toBeFocused();
		await page.setViewportSize({ width: 390, height: 844 });
		await trigger.click();
		await waitForVisualState(page);
		await page.screenshot({
			path: `../../../artifacts/ui-design-audit/screenshots/confirmation-${theme}-narrow-verified.png`,
		});
		await page.getByRole("button", { name: "Run action", exact: true }).click();
		await expect(modal).toBeHidden();
		await expect(page.getByRole("status")).toHaveText("Action confirmed");
		expect(nativeDialogs).toBe(0);
	});
	test(`shared status copy stays readable and permission actions work in ${theme}`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`/codebase-design-proof.html?theme=${theme}`);
		await expect(
			page.getByText("Approval required", { exact: true })
		).toBeVisible();
		await expect(page.locator("html")).toHaveClass(
			theme === "dark" ? /dark/ : /^$/
		);
		await waitForVisualState(page);
		for (const label of ["Approval required", "Completed", "Failed"]) {
			const ratio = await page
				.getByText(label, { exact: true })
				.evaluate((element) => {
					const canvas = document.createElement("canvas");
					canvas.width = 1;
					canvas.height = 1;
					const context = canvas.getContext("2d");
					if (!context) {
						throw new Error("No canvas color conversion context");
					}
					const rgb = (color: string) => {
						context.clearRect(0, 0, 1, 1);
						context.fillStyle = color;
						context.fillRect(0, 0, 1, 1);
						return [...context.getImageData(0, 0, 1, 1).data].map(
							(channel) => channel / 255
						);
					};
					const ancestors: Element[] = [];
					let current: Element | null = element;
					while (current) {
						ancestors.unshift(current);
						current = current.parentElement;
					}
					let background = [1, 1, 1];
					for (const ancestor of ancestors) {
						const value = rgb(getComputedStyle(ancestor).backgroundColor);
						background = background.map(
							(channel, i) => value[i] * value[3] + channel * (1 - value[3])
						);
					}
					const foreground = rgb(getComputedStyle(element).color).slice(0, 3);
					const luminance = (channels: number[]) =>
						channels
							.map((channel) =>
								channel <= 0.040_45
									? channel / 12.92
									: ((channel + 0.055) / 1.055) ** 2.4
							)
							.reduce(
								(sum, channel, i) =>
									sum + channel * [0.2126, 0.7152, 0.0722][i],
								0
							);
					const values = [luminance(background), luminance(foreground)].sort(
						(a, b) => a - b
					);
					return (values[1] + 0.05) / (values[0] + 0.05);
				});
			expect(ratio, `${label} contrast in ${theme}`).toBeGreaterThanOrEqual(
				4.5
			);
		}
		await page.getByRole("button", { name: "Allow once", exact: true }).click();
		await expect(page.getByText("Approved", { exact: true })).toBeVisible();
		await waitForVisualState(page);
		await page.screenshot({
			path: `../../../artifacts/ui-design-audit/screenshots/shared-${theme}-verified.png`,
		});
		expect(errors).toEqual([]);
	});

	test(`workspace menus, extension controls and web confirmation render in ${theme}`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(
			`/codebase-design-proof.html?surface=desktop&theme=${theme}`
		);
		await page
			.getByRole("button", { name: "Choose which thread to send to" })
			.click();
		await expect(
			page.getByRole("menuitem", { name: "New thread", exact: true })
		).toBeVisible();
		await page.keyboard.press("Escape");
		await page
			.getByRole("button", { name: "View options", exact: true })
			.click();
		await page
			.getByRole("menuitemradio", { name: "List", exact: true })
			.click();
		await expect(
			page.getByRole("menuitemradio", { name: "List", exact: true })
		).toBeChecked();
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("menu", { name: "View options", exact: true })
		).toBeHidden();
		await page
			.getByRole("button", { name: "View options", exact: true })
			.click();
		await expect(
			page.getByRole("menuitemradio", { name: "List", exact: true })
		).toBeChecked();
		await waitForVisualState(page);
		await page.screenshot({
			path: `../../../artifacts/ui-design-audit/screenshots/desktop-${theme}-verified.png`,
		});
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "extension", exact: true }).click();
		await page.getByRole("button", { name: "Stop", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Start", exact: true })
		).toBeVisible();
		await waitForVisualState(page);
		await page.screenshot({
			path: `../../../artifacts/ui-design-audit/screenshots/extension-${theme}-verified.png`,
		});
		await page.getByRole("button", { name: "web", exact: true }).click();
		await expect(
			page.getByRole("heading", { name: "Your email was verified" })
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Sign in", exact: true })
		).toHaveAttribute("href", "/login");
		await waitForVisualState(page);
		await page.screenshot({
			path: `../../../artifacts/ui-design-audit/screenshots/web-${theme}-verified.png`,
		});
		await page.getByRole("button", { name: "island", exact: true }).click();
		await page
			.getByRole("switch", { name: "Read screen context", exact: true })
			.check();
		await expect(
			page.getByRole("switch", { name: "Read screen context", exact: true })
		).toBeChecked();
		await waitForVisualState(page);
		await page.screenshot({
			path: `../../../artifacts/ui-design-audit/screenshots/island-${theme}-verified.png`,
		});
		await page.setViewportSize({ width: 390, height: 844 });
		await expect
			.poll(() =>
				page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
			)
			.toBe(true);
		await waitForVisualState(page);
		await page.screenshot({
			path: `../../../artifacts/ui-design-audit/screenshots/island-${theme}-narrow-verified.png`,
		});
		expect(errors).toEqual([]);
	});
}
