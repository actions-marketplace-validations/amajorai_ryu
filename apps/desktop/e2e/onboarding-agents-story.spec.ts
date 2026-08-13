// Real-browser spec for the onboarding `agents` step (`e2e/harness/
// onboarding-agents-story.{html,tsx}`), which mounts the REAL `OnboardingView`
// in its three states: a healthy detection, a failed lookup, and a retry.
//
// What it certifies: a FAILED agent lookup still produces a usable step. That is
// the regression this covers — the container used to gate the step on the
// catalog returning rows, so a 401 from a freshly-token-minting Core emptied both
// buckets and "Add your agents" silently vanished from the wizard. The view half
// of the fix is that `agentsUnavailable` degrades the step's CONTENT (curated
// rows plus an inline retry) and never its existence.

import { expect, test } from "@playwright/test";

const STORY_URL = "/onboarding-agents-story.html";

const failed = (page: import("@playwright/test").Page) =>
	page.getByTestId("column-failed");
const detected = (page: import("@playwright/test").Page) =>
	page.getByTestId("column-detected");

test.describe("onboarding agents step — real component in isolation", () => {
	test("a failed lookup still renders the step, with the curated rows", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		const column = failed(page);
		// The header is the proof the step exists at all.
		await expect(column.getByText("Add your agents")).toBeVisible();
		// …and it is not an empty screen: the curated set is static, so it never
		// needed the network call whose failure used to delete the step.
		await expect(column.getByText("Suggested")).toBeVisible();
		for (const name of [
			"Claude Code",
			"Codex",
			"Cursor",
			"Gemini CLI",
			"opencode",
			"GitHub Copilot CLI",
		]) {
			await expect(column.getByText(name, { exact: true })).toBeVisible();
		}
		// Nothing could be detected, so that section is absent rather than empty.
		await expect(column.getByText("Found on your system")).toHaveCount(0);
	});

	test("the failure notice offers a working retry", async ({ page }) => {
		await page.goto(STORY_URL);
		const column = failed(page);
		await expect(
			column.getByText(
				"Couldn't check what's already installed on this device.",
				{
					exact: false,
				}
			)
		).toBeVisible();
		await expect(column.getByTestId("retry-count")).toHaveText("0");
		await column.getByRole("button", { name: "Retry" }).click();
		await expect(column.getByTestId("retry-count")).toHaveText("1");
	});

	test("a retry in flight disables its own button", async ({ page }) => {
		await page.goto(STORY_URL);
		const column = page.getByTestId("column-retrying");
		const button = column.getByRole("button", { name: "Checking…" });
		await expect(button).toBeVisible();
		await expect(button).toBeDisabled();
	});

	test("an empty result explains itself instead of showing a bare header", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		const column = page.getByTestId("column-empty");
		// The step is still there — always shown, never gated on a result…
		await expect(column.getByText("Add your agents")).toBeVisible();
		// …and the one genuinely empty case (everything already added) says so.
		await expect(column.getByTestId("agents-empty")).toBeVisible();
		// Not the failure notice: this lookup answered, it just had nothing to add.
		await expect(column.getByRole("button", { name: "Retry" })).toHaveCount(0);
	});

	test("a healthy lookup leads with what it found, pre-selected", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		const column = detected(page);
		await expect(column.getByText("Found on your system")).toBeVisible();
		// Both detected agents start ticked, so Continue adds them without a click.
		await expect(column.getByTestId("selected-count")).toHaveText("2");
		await expect(
			column.getByRole("button", { name: "Add 2 & continue" })
		).toBeVisible();
		// No failure notice when the lookup answered.
		await expect(column.getByRole("button", { name: "Retry" })).toHaveCount(0);
	});
});
