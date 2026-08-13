// Real-browser spec for the composer's status line (`e2e/harness/
// composer-summary-story.{html,tsx}`), which mounts the REAL
// `ComposerSettingsMenu` with the section shapes the composer hook builds.
//
// The contract under test (from composer-trigger-summary.ts + the trigger JSX):
//   • a recognised permission mode is its ICON + colour, with no word — but its
//     name survives in the accessible name and on hover;
//   • reasoning effort rides the model after an en dash, not as another bullet;
//   • the ACP harness sits in parentheses on the agent name;
//   • a decorated mode whose value resolves NO decoration keeps its text, so
//     opencode's `build` does not render as an empty gap.

import { expect, type Page, test } from "@playwright/test";

// Cold Vite compiles the dropdown + icon module graph on first navigation.
test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/composer-summary-story.html";

function trigger(page: Page, mount: "ryu" | "opencode" | "ryu-compact") {
	return page.getByTestId(mount).getByRole("button");
}

test("the mode is an icon, and its word is gone from the line", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	const bar = trigger(page, "ryu");
	await expect(bar).toBeVisible();
	const text = (await bar.innerText()).replace(/\s+/g, " ").trim();
	// The whole point: four bulleted words became two facts plus an icon.
	expect(text).toContain("Ryu (pi)");
	expect(text).toContain("Claude Sonnet 4.5 – High");
	expect(text).not.toContain("Accept edits");
	// The effort is folded IN, so it never gets a bullet of its own.
	expect(text).not.toContain("· High");
});

test("dropping the mode's word does not drop it from a11y", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	const bar = trigger(page, "ryu");
	await expect(bar).toHaveAttribute("aria-label", /Accept edits/);
	// …and hovering the icon still says which mode it is.
	await expect(
		page.getByTestId("ryu").locator('[title="Accept edits"]')
	).toBeVisible();
});

test("the mode icon actually paints (not an empty gap)", async ({ page }) => {
	await page.goto(STORY_URL);
	const icon = page
		.getByTestId("ryu")
		.locator('[title="Accept edits"] svg')
		.first();
	const box = await icon.boundingBox();
	expect(box?.width ?? 0).toBeGreaterThan(8);
	expect(box?.height ?? 0).toBeGreaterThan(8);
});

test("the compact trigger names the agent WITH its harness, and nothing else", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	const text = (await trigger(page, "ryu-compact").innerText())
		.replace(/\s+/g, " ")
		.trim();
	// The harness is part of the agent's name, so it rides into compact too…
	expect(text).toContain("Ryu (pi)");
	// …but compact still names ONLY the agent: model, mode and effort stay in
	// the dropdown, exactly as before.
	expect(text).not.toContain("Claude Sonnet 4.5");
	expect(text).not.toContain("High");
});

test("a mode value with no style keeps its text (opencode's `build`)", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	const text = (await trigger(page, "opencode").innerText())
		.replace(/\s+/g, " ")
		.trim();
	expect(text).toContain("OpenCode");
	expect(text).toContain("Build");
});
