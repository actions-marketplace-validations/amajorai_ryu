import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/voice-mode-call-proof.html";

test("proves the compact call screen and its live controls", async ({
	page,
}, testInfo) => {
	await page.goto(STORY_URL);

	const screen = page.getByTestId("voice-call-screen");
	await expect(screen).toBeVisible();
	await expect(screen).toHaveAccessibleName("Voice call with Ryu Assistant");
	await expect(screen).toContainText("Ryu Assistant");
	await expect(screen).not.toContainText("Connected to");
	await expect(screen).not.toContainText("Listening");
	await expect(page.getByTestId("voice-call-duration")).toHaveText(
		/^\d{2}:\d{2}$/
	);
	await expect(page.getByTestId("voice-call-transcript")).toContainText(
		"Can you walk me through the next step?"
	);
	const historyToggle = page.getByTestId("voice-call-transcript-toggle");
	await expect(historyToggle).toHaveAttribute("aria-expanded", "true");
	await historyToggle.click();
	await expect(historyToggle).toHaveAttribute("aria-expanded", "false");
	await expect(page.getByTestId("voice-call-transcript")).toHaveCount(0);
	await historyToggle.click();
	await expect(historyToggle).toHaveAttribute("aria-expanded", "true");
	await expect(page.getByTestId("voice-call-transcript")).toBeVisible();
	await historyToggle.click();
	await expect(historyToggle).toHaveAttribute("aria-expanded", "false");
	await expect(page.getByTestId("voice-call-transcript")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "End call" })).toBeVisible();
	const composer = page.getByTestId("voice-call-composer");
	await expect(composer).toBeVisible();
	const textbox = composer.getByRole("textbox");
	await expect(textbox).toHaveAttribute("placeholder", "Send a message");
	await textbox.fill("Use text chat for this turn");
	await expect(composer.getByRole("button", { name: "Send" })).toBeVisible();

	const mute = page.getByRole("button", { name: "Mute microphone" });
	await mute.click();
	await expect(
		page.getByRole("button", { name: "Unmute microphone" })
	).toHaveAttribute("aria-pressed", "true");
	await expect(screen).toContainText("Microphone muted");

	await page.screenshot({
		path: testInfo.outputPath("voice-mode-call-proof.png"),
		fullPage: true,
	});

	await composer.getByRole("button", { name: "Send" }).click();
	await expect(page.getByTestId("voice-text-sent")).toHaveText(
		"Use text chat for this turn"
	);
	await expect(textbox).toHaveValue("");

	await page.getByRole("button", { name: "Unmute microphone" }).click();
	await expect(
		page.getByRole("button", { name: "Mute microphone" })
	).toHaveAttribute("aria-pressed", "false");

	await page.getByRole("button", { name: "End call" }).click();
	await expect(page.getByTestId("voice-call-screen")).toHaveCount(0);
	await expect(page.getByPlaceholder("Ask a follow up")).toBeVisible();
});
