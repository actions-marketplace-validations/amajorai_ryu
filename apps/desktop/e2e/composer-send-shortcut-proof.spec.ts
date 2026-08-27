import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	COMPOSER_SEND_SHORTCUT_KEY,
	type ComposerSendShortcut,
} from "../src/hooks/useComposerSendShortcut.ts";

test.describe.configure({ timeout: 90_000 });

const PROOF_COMPLETED_EVENT = "composer-send-shortcut-proof-complete";
const COMPLETED_CHECKS = [
	"default-enter-send",
	"shift-enter-newline",
	"shift-enter-send",
	"command-enter-newline",
	"command-enter-send",
	"reload-persistence",
] as const;
const STORY_URL = "/composer-send-shortcut-proof.html";
const SCREENSHOT_PATH = "test-results/composer-send-shortcut-proof.png";

async function resetPreference(page: Page) {
	await page.goto(STORY_URL);
	await page.evaluate(
		(key: string) => localStorage.removeItem(key),
		COMPOSER_SEND_SHORTCUT_KEY
	);
	await page.reload();
}

async function chooseShortcut(page: Page, optionLabel: string) {
	const combobox = page.getByRole("combobox", { name: "Send shortcut" });
	await combobox.click();
	await page.getByRole("option", { name: optionLabel }).click();
	await expect(combobox).toContainText(optionLabel);
}

async function submittedMessages(page: Page): Promise<string[]> {
	return page
		.getByTestId("composer-proof-sends")
		.locator("li")
		.evaluateAll((items) =>
			items
				.map(
					(item) => item.textContent?.replace(/^\s*\d+\.\s*/, "").trim() ?? ""
				)
				.filter((text) => text.length > 0 && text !== "No sends yet")
		);
}

async function expectSubmittedMessages(page: Page, expected: string[]) {
	await expect
		.poll(() => submittedMessages(page), { message: "submitted messages log" })
		.toEqual(expected);
}

async function expectClearedInput(input: Locator) {
	await expect(input).toHaveValue("");
}

async function markProofVerified(
	page: Page,
	options: {
		completedChecks: string[];
		expectedShortcut: ComposerSendShortcut;
	}
) {
	await page.evaluate(
		({
			eventName,
			detail,
		}: {
			eventName: string;
			detail: {
				completedChecks: string[];
				expectedShortcut: ComposerSendShortcut;
			};
		}) => {
			window.dispatchEvent(new CustomEvent(eventName, { detail }));
		},
		{
			eventName: PROOF_COMPLETED_EVENT,
			detail: options,
		}
	);
}

test("proves desktop composer send shortcut modes and persistence", async ({
	page,
}) => {
	const consoleErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("pageerror", (error) => {
		consoleErrors.push(error.message);
	});

	await resetPreference(page);

	const combobox = page.getByRole("combobox", { name: "Send shortcut" });
	const input = page.getByTestId("composer-proof-input");
	const status = page.getByTestId("composer-proof-status");

	await expect(combobox).toContainText("Enter");
	await input.fill("Default Enter sends");
	await input.press("Enter");
	await expectSubmittedMessages(page, ["Default Enter sends"]);
	await expectClearedInput(input);

	await chooseShortcut(page, "Shift + Enter");
	await input.fill("Shift newline");
	await input.press("Enter");
	await expect(input).toHaveValue("Shift newline\n");
	await input.fill("Shift send");
	await input.press("Shift+Enter");
	await expectSubmittedMessages(page, ["Default Enter sends", "Shift send"]);
	await expectClearedInput(input);

	await chooseShortcut(page, "Command/Ctrl + Enter");
	await input.fill("Command newline");
	await input.press("Enter");
	await expect(input).toHaveValue("Command newline\n");
	await input.fill("Command send");
	await input.press("Control+Enter");
	await expectSubmittedMessages(page, [
		"Default Enter sends",
		"Shift send",
		"Command send",
	]);
	await expectClearedInput(input);

	await page.reload();
	await expect(
		page.getByRole("combobox", { name: "Send shortcut" })
	).toContainText("Command/Ctrl + Enter");
	await expect(status).toHaveText("PENDING");
	await markProofVerified(page, {
		completedChecks: [...COMPLETED_CHECKS],
		expectedShortcut: "command-enter",
	});
	await expect(status).toHaveText("VERIFIED");
	expect(consoleErrors).toEqual([]);

	await page.screenshot({ fullPage: true, path: SCREENSHOT_PATH });
});
