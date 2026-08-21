// Real-browser spec for the recovery story (`e2e/harness/
// chat-recovery-story.{html,tsx}`). It checks the actual rendered state rather
// than only the props: both notices must be separator markers, and the empty
// composer must be the quiet Play affordance with no voice-mode label.

import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/chat-recovery-story.html";

test("recovery notices are separators and idle composer is Play by default", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	const transcript = page.getByTestId("recovery-transcript");
	const markers = transcript.locator('[data-slot="marker"]');
	await expect(markers).toHaveCount(3);
	for (let i = 0; i < 3; i += 1) {
		await expect(markers.nth(i)).toHaveAttribute("data-variant", "separator");
	}
	await expect(
		transcript.getByText(/Interrupted — this reply was cut off/)
	).toBeVisible();
	await expect(
		transcript.getByText("Earlier context was compacted")
	).toBeVisible();
	await expect(
		transcript.getByText("Compacting earlier context")
	).toBeVisible();

	const composer = page.getByTestId("recovery-composer");
	const send = composer.getByRole("button", { name: "Send", exact: true });
	await expect(send).toBeVisible();
	await expect(send).toBeDisabled();
	await expect(send).toHaveText("");
	await expect(send.locator("svg")).toHaveClass(/player-play-filled/);
	await expect(
		composer.getByRole("button", { name: "Start voice mode" })
	).toHaveCount(0);
	await expect(
		composer.getByRole("button", { name: "Start voice input" })
	).toBeVisible();
});
