import { expect, test } from "@playwright/test";

const STORY_URL = "/a2a-settings-proof.html";

test("configures inbound and outbound A2A from the real settings surface", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.goto(STORY_URL);
	await page.waitForLoadState("networkidle");
	expect(pageErrors).toEqual([]);
	await expect(page.getByTestId("proof-status")).toHaveText(
		"VERIFIED · BIDIRECTIONAL"
	);
	await expect(page.getByText("Agent-to-Agent endpoint")).toBeVisible();
	await expect(
		page.getByText("Hermes Research", { exact: true })
	).toBeVisible();
	await expect(
		page.getByText("task-market-brief", { exact: true })
	).toBeVisible();
	await expect(page.getByLabel("Maximum concurrent tasks")).toHaveValue("16");

	await page.getByLabel("Credential").selectOption("oauth2_client_credentials");
	await page
		.getByLabel("Token URL")
		.fill("https://auth.example.com/oauth/token");
	await page.getByLabel("Client ID").fill("proof-client");
	await page.getByLabel("Client secret").fill("proof-secret");
	await expect(page.getByLabel("Scopes (optional)")).toBeVisible();

	await page.getByRole("button", { name: "Add to Agents" }).first().click();
	await expect(page.getByRole("button", { name: "Added" })).toBeVisible();

	await page.getByRole("button", { name: "Trust" }).click();
	await expect(page.getByTestId("proof-events")).toContainText(
		"Peer trust changed · trusted"
	);

	await page.getByLabel("Peer name").fill("Reference verifier");
	await page.getByRole("button", { name: "Issue token" }).click();
	await expect(page.getByText("Copy this token now")).toBeVisible();

	await page.getByRole("button", { name: "Save endpoint" }).click();
	await expect(page.getByTestId("proof-events")).toContainText(
		"Endpoint saved · inbound on"
	);
	await page.getByText("View artifacts").click();
	await expect(page.getByText("Artifact · brief")).toBeVisible();

	await page.screenshot({
		fullPage: true,
		path: "../../artifacts/a2a-settings-proof.png",
	});
});
