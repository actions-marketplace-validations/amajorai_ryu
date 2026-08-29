import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/credit-sidebar-warning-proof.html";
const PROOF_SCREENSHOT = path.resolve(
	import.meta.dirname,
	"../../../artifacts/credit-sidebar-warning-proof.png"
);

test("shows the org wallet warning for the active managed node", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			pageErrors.push(message.text());
		}
	});

	await page.goto(STORY_URL);
	const wallet = page.getByTestId("managed-node-wallet");
	await expect(wallet).toBeVisible();
	await expect(wallet).toHaveAttribute("data-credit-state", "low");
	await expect(wallet).toContainText("4% credits remaining");
	await expect(wallet).toContainText("A Major");
	await expect(wallet.getByRole("progressbar")).toHaveAttribute(
		"aria-valuenow",
		"4"
	);
	await expect(
		wallet.getByRole("button", { name: "Add credits" })
	).toBeVisible();
	await expect(wallet).toContainText(/Resets \w+ \d+/);
	await page.screenshot({ fullPage: true, path: PROOF_SCREENSHOT });

	await wallet.getByRole("button", { name: "Add credits" }).click();
	await expect(page.getByTestId("settings-probe")).toHaveText("credits:open");

	if (pageErrors.length > 0) {
		throw new Error(
			`Credit sidebar proof logged errors: ${pageErrors.join(" | ")}`
		);
	}
});
