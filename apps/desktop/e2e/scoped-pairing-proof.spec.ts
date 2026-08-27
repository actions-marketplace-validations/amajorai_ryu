import path from "node:path";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const PROOF_SCREENSHOT = path.resolve(
	import.meta.dirname,
	"../../../artifacts/auth/scoped-pairing-proof.png"
);

test("scoped pairing narrows, grants, and revokes access", async ({ page }) => {
	const browserErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			browserErrors.push(message.text());
		}
	});
	page.on("pageerror", (error) => browserErrors.push(String(error)));

	await page.goto("/scoped-pairing-proof.html");
	await expect(page.locator('body[data-harness-ready="1"]')).toBeVisible();
	await expect(page.getByRole("heading", { name: "Devices waiting to connect" })).toBeVisible();
	await expect(page.getByText("Research browser", { exact: true })).toBeVisible();
	await expect(page.getByText("J7K-PQM", { exact: true })).toBeVisible();
	await expect(
		page.getByText(
			"Binding: Organization: org-proof, Team: team-proof, Plugin: com.ryu.search, Tool: search",
			{ exact: true }
		)
	).toBeVisible();
	await expect(page.getByText(/^Expires /).first()).toBeVisible();

	const grantGroup = page.getByRole("group", { name: "Grant access" });
	await expect(grantGroup.getByRole("checkbox", { name: "chat:read" })).toBeChecked();
	await expect(grantGroup.getByRole("checkbox", { name: "chat:write" })).toBeChecked();
	await expect(grantGroup.getByRole("checkbox", { name: "tools:read" })).toBeChecked();
	await grantGroup.getByRole("checkbox", { name: "chat:write" }).uncheck();
	await expect(grantGroup.getByRole("checkbox", { name: "chat:write" })).not.toBeChecked();

	await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
	await expect(page.getByText("Expired", { exact: true })).toBeVisible();
	await expect(page.getByText("Inactive", { exact: true })).toBeVisible();
	await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Revoke Expired CI runner" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Revoke Inactive tablet" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Revoke Revoked browser" })).toHaveCount(0);

	await page
		.getByRole("button", { name: "Approve Research browser with requested access" })
		.click();
	await expect(page.getByText("Research browser", { exact: true })).toBeVisible();
	await expect(page.getByText("J7K-PQM", { exact: true })).toHaveCount(0);
	const approval = await page.evaluate(() => {
		return (
			window as typeof window & {
				__SCOPED_PAIRING_PROOF__: { lastApproval: unknown };
			}
		).__SCOPED_PAIRING_PROOF__.lastApproval;
	});
	expect(approval).toEqual({
		granted_scopes: ["chat:read", "tools:read"],
		user_code: "J7K-PQM",
	});

	const researchRow = page
		.locator("li")
		.filter({ has: page.getByText("Research browser", { exact: true }) });
	const grantedAccess = researchRow.getByRole("list", { name: "Granted access" });
	await expect(grantedAccess.getByText("chat:read", { exact: true })).toBeVisible();
	await expect(grantedAccess.getByText("tools:read", { exact: true })).toBeVisible();
	await expect(grantedAccess.getByText("chat:write", { exact: true })).toHaveCount(0);

	await page.getByRole("button", { name: "Revoke VS Code MCP" }).click();
	const vscodeRow = page
		.locator("li")
		.filter({ has: page.getByText("VS Code MCP", { exact: true }) });
	await expect(vscodeRow.getByText("Revoked", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Revoke VS Code MCP" })).toHaveCount(0);

	await mkdir(path.dirname(PROOF_SCREENSHOT), { recursive: true });
	await page.screenshot({ fullPage: true, path: PROOF_SCREENSHOT });
	expect(browserErrors).toEqual([]);
});
