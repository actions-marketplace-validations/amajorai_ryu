import { expect, test } from "@playwright/test";

test("opens Invite a friend at the referral page", async ({ page }) => {
	await page.goto("/desktop-menu-parity-proof.html");
	await page.getByRole("button", { name: "Desktop user nav" }).click();
	await page.getByRole("menuitem", { name: "Invite a friend" }).click();
	await expect(page.getByTestId("opened-path")).toHaveText("/referrals");
});
