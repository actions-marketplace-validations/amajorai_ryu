import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("shows duplicate-safe gateway onboarding and creates the default Telegram route", async ({
	page,
}) => {
	await page.goto("/onboarding-gateway-setup-proof.html");
	await expect(page.getByTestId("existing-channels-proof")).toContainText(
		"You already have channels"
	);
	await expect(page.getByTestId("profile-rebuild-proof")).toContainText(
		"You already did this before"
	);
	await expect(
		page.getByTestId("profile-rebuild-proof").getByRole("button", {
			name: "Rebuild Profile",
		})
	).toBeVisible();

	const telegram = page.getByTestId("new-telegram-proof");
	await telegram
		.getByRole("button", { name: "Log in with Telegram", exact: true })
		.click();
	await expect(telegram).toContainText("Telegram Login opened in your browser");
	await telegram.getByRole("button", { name: "Create a bot for me" }).click();
	await expect(telegram).toContainText("Waiting for Telegram");
	await expect(telegram).toContainText("@ryu_onboarding_bot", {
		timeout: 10_000,
	});
	const connect = telegram.getByRole("button", {
		name: "Connect @ryu_onboarding_bot",
	});
	await expect(connect).toBeVisible();
	await connect.scrollIntoViewIfNeeded();
	await connect.click();
	await expect(telegram).toContainText(
		"Messages route to the default Ryu agent"
	);
	await telegram.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(page.getByTestId("proof-status")).toHaveText(
		"Telegram setup complete"
	);
	await page.screenshot({
		path: "e2e/harness/onboarding-gateway-setup-proof.png",
		fullPage: true,
	});
});
