import { expect, test } from "@playwright/test";

const STORY_URL = "/managed-channel-provisioning-proof.html";

test("shows a ready managed bot without requiring customer auth", async ({
	page,
}) => {
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("pageerror", (error) => pageErrors.push(String(error)));

	await page.goto(STORY_URL);
	await page.waitForSelector("body[data-harness-ready='1']");

	await expect(page.getByRole("alert")).toHaveCount(2);
	await expect(page.getByRole("alert").first()).toContainText(
		"Dedicated Ryu-managed bot"
	);
	await expect(page.getByRole("alert").last()).toContainText(
		"Dedicated Ryu-managed bot"
	);
	await expect(
		page.getByText(
			"Ryu has already connected this dedicated bot to your managed node."
		)
	).toHaveCount(2);
	const telegramLink = page.getByRole("link", { name: "Open in Telegram" });
	await expect(telegramLink).toHaveAttribute("href", "https://t.me/ryu_node_a");
	await expect(telegramLink).toHaveAttribute("target", "_blank");
	await expect(telegramLink).toHaveAttribute("rel", "noopener noreferrer");
	const discordLink = page.getByRole("link", { name: "Install in Discord" });
	await expect(discordLink).toHaveAttribute(
		"href",
		"https://discord.com/oauth2/authorize?client_id=123456789012345678"
	);
	await expect(discordLink).toHaveAttribute("target", "_blank");
	await expect(discordLink).toHaveAttribute("rel", "noopener noreferrer");
	await expect(
		page.getByLabel("Replace with your own bot token (optional)")
	).toBeVisible();
	await expect(
		page.getByPlaceholder("Leave blank to keep the Ryu-managed bot")
	).toHaveCount(2);

	await page.screenshot({
		path: test.info().outputPath("managed-channel-provisioning-proof.png"),
		fullPage: true,
	});

	const unexpectedConsoleErrors = consoleErrors.filter(
		(message) =>
			!(
				message.includes("127.0.0.1:7980/api/") ||
				message.includes("Failed to load resource: net::ERR_FAILED")
			)
	);
	expect(unexpectedConsoleErrors).toEqual([]);
	expect(pageErrors).toEqual([]);
});
