import { expect, test } from "@playwright/test";

test("Prompt Studio keeps the complete local prompt-testing workflow visible", async ({
	page,
}) => {
	const browserErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			browserErrors.push(message.text());
		}
	});
	page.on("pageerror", (error) => browserErrors.push(error.message));

	await page.goto("/prompt-studio-proof.html", {
		waitUntil: "domcontentloaded",
	});
	await page.waitForLoadState("networkidle");
	await expect(page.getByTestId("proof-status")).toHaveText(
		"Production UI mounted"
	);
	await expect(page.getByText("Prompt Studio").first()).toBeVisible();
	await page.screenshot({
		fullPage: true,
		path: "artifacts/prompt-studio-proof-initial.png",
	});

	await page.getByLabel("Suite name").fill("Promptfoo regression suite");
	await page.getByLabel("Version label (optional)").fill("Baseline");
	await page.getByRole("button", { name: "Add variant" }).click();
	await page
		.getByPlaceholder(
			"A second system prompt variant. {{vars}} are rendered per case."
		)
		.fill("You are a precise assistant. Use {{topic}}.");
	await page
		.getByLabel("Registry evaluators (optional, comma-separated)")
		.fill("assertions");
	await page.getByRole("button", { name: "Save suite" }).click();
	await expect(page.getByText("1 versions")).toBeVisible();

	await page.getByRole("button", { name: "Add test case" }).click();
	await page.getByLabel("User message").fill("Explain {{topic}}");
	await page.getByLabel("Assertion threshold (optional)").fill("0.5");
	await page.getByRole("button", { name: "Add assertion" }).click();
	await page.getByLabel("Assertion type").selectOption("icontains_any");
	await page.getByLabel("Assertion value").fill("concise,brief");
	await page.getByRole("button", { name: "Add model" }).click();
	await page.getByLabel("Add model to compare").fill("gpt-4.1-mini");
	await page.getByRole("button", { name: "Add model" }).click();
	await page.getByRole("button", { name: "Run test cases" }).click();
	await expect(page.getByText("Overall").first()).toBeVisible();
	await expect(
		page.getByText("A concise explanation of prompt engineering.").first()
	).toBeVisible();
	await page.getByRole("button", { name: "Pass" }).first().click();
	await page
		.getByLabel("Human review comment")
		.first()
		.fill("Keep this concise.");
	await page.getByRole("button", { name: "Save comment" }).first().click();
	await page
		.getByRole("button", { name: /Promptfoo regression suite · proof/ })
		.click();

	await page.getByRole("button", { name: "Save version" }).click();
	await page.getByRole("button", { name: /History/ }).click();
	await expect(page.getByRole("listitem").getByText("Baseline")).toBeVisible();
	await page.getByRole("button", { name: "Diff" }).click();
	await expect(
		page.getByText(/You are a concise assistant/).first()
	).toBeVisible();
	await page.screenshot({
		fullPage: true,
		path: "artifacts/prompt-studio-proof-complete.png",
	});
	await page.getByRole("button", { name: "Restore" }).click();

	expect(browserErrors).toEqual([]);
});
