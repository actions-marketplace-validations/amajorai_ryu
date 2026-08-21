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
	await expect(page.getByTestId("voice-call-duration")).toHaveText(
		/^\d{2}:\d{2}$/
	);
	await expect(page.getByTestId("voice-call-transcript")).toContainText(
		"Can you walk me through the next step?"
	);
	await expect(page.getByRole("button", { name: "End call" })).toBeVisible();

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

	await page.getByRole("button", { name: "Unmute microphone" }).click();
	await expect(
		page.getByRole("button", { name: "Mute microphone" })
	).toHaveAttribute("aria-pressed", "false");

	await page.getByRole("button", { name: "End call" }).click();
	await expect(page.getByText("Call ended", { exact: true })).toBeVisible();
	await expect(page.getByTestId("voice-call-screen")).toHaveCount(0);
});
