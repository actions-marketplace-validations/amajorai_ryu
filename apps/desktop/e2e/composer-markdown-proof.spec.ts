// Real-browser proof for the optional rich composer. The story mounts the same
// shared ComposerEditor used by the desktop input bar and keeps the lightweight
// textarea as the default state.

import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/composer-markdown-proof.html";

test("Markdown paste creates an editable link in rich mode", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	await expect(
		page.getByRole("textbox", { name: "Lightweight composer" })
	).toBeVisible();

	await page.getByRole("checkbox", { name: "Rich Markdown composer" }).check();
	const editor = page.getByRole("textbox").first();
	await editor.click();
	await page.evaluate(() => {
		const target = document.activeElement;
		if (!(target instanceof HTMLElement)) {
			throw new Error("Composer editor did not receive focus");
		}
		const data = new DataTransfer();
		data.setData("text/plain", "[Project plan](https://example.com/plan)");
		target.dispatchEvent(
			new ClipboardEvent("paste", { bubbles: true, clipboardData: data })
		);
	});

	const link = page.getByRole("link", { name: "Project plan" });
	await expect(link).toHaveAttribute("href", "https://example.com/plan");
	await page.getByRole("button", { name: "Edit link" }).click();
	await expect(page.getByPlaceholder("Paste link")).toHaveValue(
		"https://example.com/plan"
	);
	await expect(page.getByPlaceholder("Text to display")).toHaveValue(
		"Project plan"
	);

	await page.getByPlaceholder("Paste link").fill("https://example.com/updated");
	await page.getByPlaceholder("Text to display").fill("Project roadmap");
	await page.getByPlaceholder("Text to display").press("Enter");
	await expect(
		page.getByRole("link", { name: "Project roadmap" })
	).toHaveAttribute("href", "https://example.com/updated");
});
