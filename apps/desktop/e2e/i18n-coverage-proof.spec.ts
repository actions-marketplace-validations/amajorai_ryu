import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

test("localizes every legacy DOM surface without translating code or dynamic content", async ({
	page,
}, testInfo) => {
	const browserErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			browserErrors.push(message.text());
		}
	});

	await page.setViewportSize({ height: 900, width: 1280 });
	await page.goto("/i18n-coverage-proof.html", {
		waitUntil: "domcontentloaded",
	});

	const proof = page.getByTestId("i18n-coverage-proof");
	await expect(proof).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("lang", "es");
	await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
	await expect(proof.locator("h1")).toHaveText("Actividad");
	await expect(proof.getByRole("button", { name: "Cancelar" })).toHaveText(
		"Cancelar"
	);
	await expect(proof.locator("input")).toHaveAttribute("placeholder", "Buscar");
	await expect(proof.locator("input")).toHaveAttribute("title", "Estado");
	await expect(proof.getByTestId("dynamic-content")).toHaveText(
		"Project Alpha"
	);
	await expect(proof.getByTestId("code-content")).toHaveText("Cancel");
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("i18n-coverage-spanish-proof.png"),
	});

	await proof.getByTestId("switch-arabic").click();
	await expect(page.locator("html")).toHaveAttribute("lang", "ar");
	await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
	await expect(proof.locator("h1")).toHaveText("النشاط");
	await expect(proof.getByRole("button", { name: "إلغاء" })).toHaveText(
		"إلغاء"
	);
	await expect(proof.locator("input")).toHaveAttribute("placeholder", "بحث");
	await expect(proof.locator("input")).toHaveAttribute("title", "الحالة");
	await expect(proof.getByTestId("dynamic-content")).toHaveText(
		"Project Alpha"
	);
	await expect(proof.getByTestId("code-content")).toHaveText("Cancel");
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("i18n-coverage-arabic-proof.png"),
	});

	expect(browserErrors, `browser errors: ${browserErrors.join(" | ")}`).toEqual(
		[]
	);
});
