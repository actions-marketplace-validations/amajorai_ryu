import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

test("localizes the desktop welcome surface and switches to Arabic RTL", async ({
	page,
}, testInfo) => {
	const browserErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			browserErrors.push(message.text());
		}
	});

	await page.setViewportSize({ height: 900, width: 900 });
	await page.goto("/login-i18n-proof.html", {
		waitUntil: "domcontentloaded",
	});

	await expect(page.locator("html")).toHaveAttribute("lang", "es");
	await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
	await expect(
		page.getByRole("heading", { name: "Hola, soy Ryu" })
	).toBeVisible();
	await expect(
		page.getByText("Tu fantasma amigable que vive en tu escritorio")
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Comenzar" })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Probar Ryu sin una cuenta" })
	).toBeVisible();
	await expect(page.getByTestId("switch-arabic")).toHaveText("Cambiar a árabe");
	await expect(page.getByRole("heading").locator("..")).toHaveCSS(
		"opacity",
		"1"
	);
	await expect(
		page.getByRole("button", { name: "Comenzar" }).locator("..")
	).toHaveCSS("opacity", "1");
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("login-spanish-proof.png"),
	});

	await page.getByTestId("switch-arabic").click();
	await expect(page.locator("html")).toHaveAttribute("lang", "ar");
	await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
	await expect(
		page.getByRole("heading", { name: "مرحبًا، أنا Ryu" })
	).toBeVisible();
	await expect(
		page.getByText("شبحك الودود الذي يعيش على سطح مكتبك")
	).toBeVisible();
	await expect(page.getByRole("button", { name: "البدء" })).toBeVisible();
	await expect(page.getByTestId("switch-arabic")).toHaveText(
		"التبديل إلى العربية"
	);
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("login-arabic-proof.png"),
	});

	expect(browserErrors, `browser errors: ${browserErrors.join(" | ")}`).toEqual(
		[]
	);
});
