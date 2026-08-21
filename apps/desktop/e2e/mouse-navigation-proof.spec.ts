import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("mouse back and forward buttons follow the desktop navigation history", async ({
	page,
}) => {
	await page.goto("/mouse-navigation-proof.html");

	await expect(page.getByTestId("active-page")).toHaveText("Spaces");
	await page.getByTestId("mouse-back").click();
	await expect(page.getByTestId("active-page")).toHaveText("Agents");
	await expect(page.getByTestId("navigation-count")).toHaveText("1 action");
	await expect(page.getByTestId("last-input")).toHaveText(
		"Mouse back button · button 3"
	);
	await expect(page.getByTestId("native-default")).toHaveText(
		"Native navigation prevented"
	);

	await page.getByTestId("mouse-forward").click();
	await expect(page.getByTestId("active-page")).toHaveText("Spaces");
	await expect(page.getByTestId("navigation-count")).toHaveText("2 actions");
	await expect(page.getByTestId("last-input")).toHaveText(
		"Mouse forward button · button 4"
	);
	await expect(page.getByTestId("proof-status")).toHaveAttribute(
		"data-proof-status",
		"pass"
	);

	await page.screenshot({
		path: "e2e/harness/mouse-navigation-proof.png",
	});
});
