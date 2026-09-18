import { expect, test } from "@playwright/test";

const PROMPTFOO_CONFIG = {
	code_evaluators: [
		{
			id: "safe_output",
			lang: "js",
			source: '({ score: output.includes("safe") ? 1 : 0 })',
		},
	],
	defaultTest: {
		vars: { locale: "en" },
		assert: [{ type: "contains", value: "concise" }],
	},
	judge_model: "gpt-4o-mini",
	prompts: [
		{
			content: "You are concise. Answer {{topic}}.",
			id: "primary",
			name: "Primary",
		},
		{
			id: "chat-variant",
			messages: [
				{ content: "You are precise.", role: "system" },
				{ content: "Answer {{topic}}.", role: "user" },
				{ content: "I will stay concise.", role: "assistant" },
			],
			name: "Chat variant",
			type: "chat",
		},
	],
	providers: ["gpt-4o-mini", "gpt-4.1-mini"],
	evaluateOptions: {
		cache: true,
		maxConcurrency: 2,
		repeat: 1,
		tags: { branch: "parity-proof" },
		timeoutMs: 5000,
	},
	tests: [
		{
			assert: [
				{ type: "contains", value: "concise" },
				{
					rubricPrompt: "The answer is concise and useful.",
					type: "llm-rubric",
				},
			],
			description: "Concise answer",
			id: "case-concise",
			metadata: { locale: "en", team: "support" },
			prompt: "Explain {{topic}}",
			vars: { topic: "prompt engineering" },
		},
		{
			assert: [{ type: "contains", value: "concise" }],
			description: "Needs review",
			id: "case-review",
			metadata: { locale: "en", severity: "review", team: "support" },
			options: { prefix: "[quality] " },
			prompt: "Give a short answer about {{topic}}",
			vars: { topic: "prompt engineering" },
		},
	],
};

test("Promptfoo parity proof covers import, compare, review, and export surfaces", async ({
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

	await page.locator('input[type="file"]').setInputFiles({
		buffer: Buffer.from(JSON.stringify(PROMPTFOO_CONFIG)),
		mimeType: "application/json",
		name: "promptfoo-parity.json",
	});
	await expect(page.getByTestId("promptfoo-import-preview")).toBeVisible();
	await page.getByRole("button", { name: "Apply import" }).click();
	await expect(page.getByLabel("Suite name")).toHaveValue("promptfoo-parity");
	await expect(page.locator('input[value="Chat variant"]')).toBeVisible();
	await expect(page.getByLabel("Concurrency")).toHaveValue("2");
	await expect(page.getByLabel("Timeout (ms)")).toHaveValue("5000");
	await expect(
		page.getByLabel("Custom JS/Python evaluators (Core sandbox)")
	).toHaveValue(/safe_output/);

	await page.getByLabel("Suite name").fill("Promptfoo parity suite");
	await page.getByLabel("Version label (optional)").fill("Imported baseline");
	await page.getByRole("button", { name: "Save suite" }).click();
	await expect(page.getByText("1 versions")).toBeVisible();

	await page.getByRole("button", { name: "Run test cases" }).click();
	await expect(page.getByText("Results matrix").first()).toBeVisible();
	await page.getByLabel("Result matrix filter").selectOption("all");
	await expect(page.getByText("8 visible cells")).toBeVisible();
	await expect(page.getByText("llm_rubric").first()).toBeVisible();
	await expect(page.getByText("exact_match: 100%").first()).toBeVisible();
	await expect(page.getByText("Quality by model").first()).toBeVisible();
	await expect(page.getByText("Score distribution").first()).toBeVisible();

	await page.getByLabel("Result matrix filter").selectOption("different");
	await expect(page.getByText("8 visible cells")).toBeVisible();
	await page.getByLabel("Result matrix filter").selectOption("all");
	await page.getByLabel("Search result matrix").fill("concise|review");
	const regexSwitch = page
		.locator("label")
		.filter({ hasText: "Regex search" })
		.locator('[data-slot="switch"]');
	await regexSwitch.click();
	await expect(page.getByText("8 visible cells")).toBeVisible();
	await regexSwitch.click();
	await page.getByLabel("Search result matrix").fill("");
	await page.getByLabel("Filter result metadata").fill("severity");
	await expect(page.getByText("4 visible cells")).toBeVisible();
	await page.getByLabel("Filter result metadata").fill("");
	await page.getByText("Inspect full cell").first().click();
	await page
		.getByLabel("Cell output render mode")
		.first()
		.selectOption("markdown");
	await expect(
		page.getByText("A concise explanation of prompt engineering.").first()
	).toBeVisible();

	await page.getByRole("button", { name: "Pass" }).first().click();
	await page.getByLabel("Human review score").first().fill("0.95");
	await page.getByRole("button", { name: "Highlight" }).first().click();
	await expect(
		page.getByRole("button", { name: "Highlighted" }).first()
	).toBeVisible();
	await page
		.getByLabel("Human review comment")
		.first()
		.fill("Keep this concise.");
	await page.getByRole("button", { name: "Save comment" }).first().click();
	await page.getByLabel("Result matrix filter").selectOption("highlighted");
	await expect(page.getByText("1 visible cells")).toBeVisible();
	await expect(page.url()).toContain("#promptfoo-results");

	const runName = page.locator(
		'button[aria-label^="Rename Promptfoo parity suite"]'
	);
	await expect(runName).toHaveCount(1);
	await runName.click();
	const renameInput = page.getByLabel(/Rename Promptfoo parity suite/);
	await renameInput.fill("Baseline parity run");
	await page
		.getByRole("button", { name: /Save name for Promptfoo parity suite/ })
		.click();

	const duplicate = page.locator(
		'button[aria-label^="Duplicate Baseline parity run"]'
	);
	await expect(duplicate).toHaveCount(1);
	await duplicate.click();
	await expect(
		page.getByRole("button", { name: /Baseline parity run copy/ }).first()
	).toBeVisible();

	await page.getByRole("button", { name: "Run test cases" }).click();
	await expect(page.getByText("Results matrix").first()).toBeVisible();
	await page.getByLabel("Result matrix filter").selectOption("all");
	await expect(page.getByText("8 visible cells")).toBeVisible();
	await page.getByRole("button", { name: "Pass" }).first().click();
	await page
		.getByLabel("Human review comment")
		.first()
		.fill("Reviewed after rerun.");
	await page.getByRole("button", { name: "Save comment" }).first().click();

	const compareButtons = page.locator('button[aria-label^="Compare "]');
	await expect(compareButtons).toHaveCount(3);
	await compareButtons.last().click();
	await expect(page.getByText("Run comparison")).toBeVisible();
	await expect(page.getByText(/vs /).first()).toBeVisible();

	await page.screenshot({
		fullPage: true,
		path: "artifacts/promptfoo-parity-proof-complete.png",
	});
	await page.setViewportSize({ width: 480, height: 900 });
	await page.screenshot({
		fullPage: true,
		path: "artifacts/promptfoo-parity-proof-narrow.png",
	});
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await page.screenshot({
		fullPage: true,
		path: "artifacts/promptfoo-parity-proof-dark.png",
	});

	expect(browserErrors).toEqual([]);
});
