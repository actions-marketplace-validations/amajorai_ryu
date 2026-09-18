import { expect, test } from "@playwright/test";

test("proves Bot profile card activity, approvals, goals, and feed interactions", async ({
	page,
}) => {
	const browserErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			browserErrors.push(message.text());
		}
	});
	page.on("pageerror", (error) => browserErrors.push(error.message));

	await page.setViewportSize({ height: 900, width: 1440 });
	await page.goto("/bot-profile-card-proof.html?reset=1", {
		waitUntil: "domcontentloaded",
	});
	const card = page.getByTestId("bot-profile-card");
	await expect(card).toBeVisible();
	await expect(card.getByText("Working", { exact: true })).toBeVisible();
	await expect(
		card.getByText("Working on launch plan", { exact: true })
	).toBeVisible();

	await card.getByRole("tab", { name: "Approvals" }).click();
	await expect(
		card.getByText("Send launch update", { exact: true })
	).toBeVisible();
	await card.getByRole("button", { name: "Approve" }).click();
	await expect(
		card.getByText("Nothing needs your decision", { exact: true })
	).toBeVisible();

	await card.getByRole("tab", { name: "Goals" }).click();
	await expect(card.getByText("Active · 1", { exact: true })).toBeVisible();
	await expect(card.getByText("Passive · 1", { exact: true })).toBeVisible();
	await expect(
		card.getByText("Turn the launch notes into a shippable checklist", {
			exact: true,
		})
	).toBeVisible();

	await card.getByRole("tab", { name: "Feed" }).click();
	await expect(
		card.getByText("Completed a planning pass", { exact: true })
	).toBeVisible();
	await card.getByRole("button", { name: "Like", exact: true }).first().click();
	await expect(
		card.getByRole("button", { name: "Liked", exact: true })
	).toBeVisible();
	await card
		.getByRole("button", { name: /Comment/ })
		.first()
		.click();
	await card
		.getByLabel("Comment on this activity")
		.fill("Keep this in the launch review.");
	await card.getByRole("button", { name: "Post", exact: true }).click();
	await expect(
		card.getByText("Keep this in the launch review.", { exact: true })
	).toBeVisible();

	await card.getByRole("button", { name: "Customize feed" }).first().click();
	await expect(
		page.getByText("Customize your feed", { exact: true })
	).toBeVisible();
	await page.getByRole("checkbox", { name: /Show Watch/ }).click();

	await card.getByRole("button", { name: "Collapse bot activity" }).click();
	await expect(
		card.getByRole("button", { name: "Expand bot activity" })
	).toBeVisible();
	await card.getByRole("button", { name: "Expand bot activity" }).click();
	await expect(card.getByRole("tab", { name: "Feed" })).toBeVisible();

	await page.screenshot({
		fullPage: true,
		path: "artifacts/bot-profile-card-proof-complete.png",
	});
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await page.screenshot({
		fullPage: true,
		path: "artifacts/bot-profile-card-proof-dark.png",
	});

	expect(browserErrors).toEqual([]);
});
