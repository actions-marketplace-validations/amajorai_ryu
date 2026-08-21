import { expect, type Locator, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("renders capability mentions and gates Composio integrations", async ({
	page,
}) => {
	const consoleErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await page.goto("/mention-composer-proof.html");
	await page.waitForLoadState("networkidle");

	await expect(page.getByTestId("proof-status")).toHaveText(/VERIFIED/);
	await expect(page.getByTestId("configured-state")).toContainText("CONNECTED");
	await expect(page.getByTestId("unconfigured-state")).toContainText("HIDDEN");

	const connected = page.getByTestId("configured-state");
	for (const label of [
		"Agents",
		"Apps",
		"App items",
		"Integrations",
		"Plugins",
		"Skills",
		"Space pages",
		"Output styles",
	]) {
		await expect(connected.getByText(label, { exact: true })).toBeVisible();
	}
	await connected.getByRole("option", { name: /Design brief/ }).click();
	await expect(connected.getByTestId("configured-selection")).toHaveText(
		"@Design brief"
	);
	await expect(connected.getByRole("option", { name: /GitHub/ })).toBeVisible();
	await expect(connected.getByRole("option", { name: /Slack/ })).toHaveCount(0);
	await connected.getByRole("option", { name: /GitHub/ }).click();
	await expect(connected.getByTestId("configured-selection")).toHaveText(
		"@GitHub"
	);
	await expect(connected.getByTestId("configured-header-selection")).toHaveText(
		"Selected @GitHub"
	);

	const disconnected = page.getByTestId("unconfigured-state");
	await expect(
		disconnected.getByText("Integrations", { exact: true })
	).toHaveCount(0);
	await expect(
		disconnected.getByRole("option", { name: /GitHub/ })
	).toHaveCount(0);
	const proofLog = page.getByTestId("transcript-proof-log");
	const clickAndWaitForDestination = async (
		locator: Locator,
		destination: string
	) => {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			await locator.click();
			try {
				await expect(proofLog).toContainText(destination, { timeout: 1000 });
				return;
			} catch (error) {
				if (attempt === 1) {
					throw error;
				}
			}
		}
	};

	for (const role of ["user", "agent"]) {
		const transcript = page.getByTestId(
			role === "user" ? "user-transcript-markdown" : "agent-transcript-markdown"
		);
		const browserMention = transcript.locator(
			'button[data-mention-kind="app"][data-mention-id="browser"]'
		);
		await expect(browserMention).toHaveText("Browser");
		await expect(browserMention).not.toContainText("@");
		for (const item of [
			["agent", "claude"],
			["app", "browser"],
			["app-item", "com.ryu.canvas:canvas:brief"],
			["chat", "architecture"],
			["team", "platform"],
			["workflow", "deploy"],
			["space", "personal"],
			["page", "space-1:launch-plan"],
			["output-style", "plain"],
			["skill", "research"],
			["mcp", "local-mcp"],
			["folder", "/workspace/ryu-closed"],
			["integration", "github"],
			["plugin", "double-check"],
		] as const) {
			await clickAndWaitForDestination(
				transcript.locator(
					`button[data-mention-kind="${item[0]}"][data-mention-id="${item[1]}"]`
				),
				`${role}:${item[0]}:${item[1]}`
			);
		}
		await clickAndWaitForDestination(
			transcript.getByRole("link", { name: "Open website" }),
			`${role}:website:https://example.com/mention-proof`
		);
	}
	await expect(page.getByTestId("transcript-proof-status")).toHaveText(
		/VERIFIED · all destinations opened/
	);

	await page.screenshot({
		path: "test-results/mention-composer-proof.png",
		fullPage: true,
	});
	if (consoleErrors.length > 0) {
		throw new Error(`Browser console errors: ${consoleErrors.join(" | ")}`);
	}
});
