import { expect, test } from "@playwright/test";

const STORY_URL = "/selection-actions-proof.html";
const PROOF_SCREENSHOT =
	"/Users/jiawei/.codex/visualizations/2026/08/22/01a027dd-9b70-7962-b6fc-82677e3d0006/selection-actions-proof.png";

test("renders plugin-contributed selection actions and forwards selected text", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	await expect(page.getByTestId("selection-actions-proof")).toBeVisible();

	await page.evaluate(() => {
		const target = document.querySelector('[data-testid="selection-copy"]');
		if (!target) {
			throw new Error("selection proof target missing");
		}
		const selection = window.getSelection();
		const range = document.createRange();
		range.selectNodeContents(target);
		selection?.removeAllRanges();
		selection?.addRange(range);
		document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
	});

	const toolbar = page.locator('[data-slot="selection-toolbar"]');
	await expect(toolbar).toBeVisible();
	await expect(toolbar.getByRole("button", { name: "Quote" })).toBeVisible();
	await expect(
		toolbar.getByRole("button", { name: "Ask in side chat" })
	).toBeVisible();
	await expect(toolbar.getByRole("button", { name: "Explain" })).toBeVisible();
	await expect(toolbar.locator('span[aria-hidden="true"]')).toHaveCount(2);

	await page.screenshot({ path: PROOF_SCREENSHOT, fullPage: true });
	await toolbar.getByRole("button", { name: "Explain" }).click();
	await expect(page.getByTestId("selection-event")).toContainText("Explain");
	await expect(page.getByTestId("selection-event")).toContainText(
		"A side chat uses the active main model"
	);
});
