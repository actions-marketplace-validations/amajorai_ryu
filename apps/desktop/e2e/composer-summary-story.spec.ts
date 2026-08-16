// Real-browser spec for the composer's status line (`e2e/harness/
// composer-summary-story.{html,tsx}`), which mounts the REAL
// `ComposerSettingsMenu` with the section shapes the composer hook builds.
//
// The contract under test (from composer-trigger-summary.ts + the trigger JSX):
//   • a recognised permission mode is its ICON + colour, with no word — but its
//     name survives in the accessible name and on hover;
//   • reasoning effort is a bar meter, with its level still announced;
//   • the ACP harness sits in parentheses on the agent name;
//   • a decorated mode whose value resolves NO decoration keeps its text, so
//     opencode's `build` does not render as an empty gap;
//   • the model and optional controls switch density from the composer's own
//     container width, not from the browser viewport.

import { expect, type Page, test } from "@playwright/test";

// Cold Vite compiles the dropdown + icon module graph on first navigation.
test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/composer-summary-story.html";

function trigger(page: Page, mount: "ryu" | "opencode" | "ryu-compact") {
	return page.getByTestId(mount).getByRole("button");
}

test("the mode is an icon, and effort is a bar meter", async ({ page }) => {
	await page.goto(STORY_URL);
	const bar = trigger(page, "ryu");
	await expect(bar).toBeVisible();
	const text = (await bar.innerText()).replace(/\s+/g, " ").trim();
	// The whole point: four bulleted words became two facts plus visual cues.
	expect(text).toContain("Ryu (pi)");
	expect(text).toContain("Claude Sonnet 4.5");
	expect(text).not.toContain("Accept edits");
	const meter = bar.locator('[data-composer-effort-meter="true"]');
	await expect(meter).toBeVisible();
	await expect(meter).toHaveAttribute("aria-label", "Effort: High");
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
	// …but compact still leaves model and mode words in the dropdown; the effort
	// level remains glanceable as a meter rather than taking a word-sized slot.
	expect(text).not.toContain("Claude Sonnet 4.5");
	expect(text).not.toContain("High");
	await expect(
		page
			.getByTestId("ryu-compact")
			.locator('[data-composer-effort-meter="true"]')
	).toBeVisible();
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

test("the picker adapts to its composer container", async ({ page }) => {
	await page.goto(STORY_URL);

	const wide = page.getByTestId("adaptive-wide");
	await expect(
		wide.locator(".composer-model-trigger .composer-model-name")
	).toBeVisible();
	await expect(wide.locator(".composer-model-icon")).toBeHidden();

	const medium = page.getByTestId("adaptive-medium");
	await expect(
		medium.locator(".composer-model-trigger .composer-model-name")
	).toBeHidden();
	await expect(medium.locator(".composer-model-icon")).toBeVisible();
	await expect(
		medium.locator('[data-composer-effort-meter="true"]')
	).toBeVisible();

	const tight = page.getByTestId("adaptive-tight");
	await expect(
		tight.locator(".composer-model-trigger .composer-model-name")
	).toBeHidden();
	await expect(tight.locator(".composer-model-icon")).toBeVisible();
	await expect(
		tight.locator('[data-composer-section="approval"] svg')
	).toBeVisible();
	await expect(
		tight.locator('[data-composer-effort-meter="true"]')
	).toBeVisible();
});
