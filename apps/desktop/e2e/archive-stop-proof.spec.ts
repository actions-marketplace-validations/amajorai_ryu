import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("archiving a streaming chat stops it before the archive write settles", async ({
	page,
}) => {
	await page.goto("/archive-stop-proof.html");

	await expect(page.getByTestId("proof-status")).toHaveText(
		"Reply in progress"
	);
	await page.getByTestId("archive-chat").click();

	await expect(page.getByTestId("proof-status")).toHaveText(
		"Stopped immediately"
	);
	await expect(page.getByTestId("proof-local")).toHaveText("stopped");
	await expect(page.getByTestId("proof-archive")).toHaveText("archived");
	await expect(page.getByTestId("proof-write")).toHaveText("sent");
	await expect(page.getByTestId("archive-chat")).toBeDisabled();
});
