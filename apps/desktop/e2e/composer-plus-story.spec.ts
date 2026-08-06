// Real-browser spec for the composer "+" story (`e2e/harness/
// composer-plus-story.{html,tsx}`), which mounts the REAL shared `InputBar` — the
// bar the chat page, launchpad, Ask Ryu dock and builder panes all render.
//
// The regression it guards: the "+" opened a dropdown only when the host wired an
// OPTIONAL row (goal / ghost / plugin toggle / media gen). Surfaces that wired
// none — the launchpad and the builder panes — silently got a bare button that
// opened the OS file picker instead. Both spellings compile and both build, so
// this has to be clicked to be certified.

import { expect, test } from "@playwright/test";

// The story pulls a large module graph; vite compiles it on first navigation, so
// allow generous headroom over the 30s default for cold-start CI runs.
test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/composer-plus-story.html";

/** The "+" trigger inside one of the story's two mounts. */
function plusIn(page: import("@playwright/test").Page, testId: string) {
	return page.getByTestId(testId).getByRole("button", { name: "Add" });
}

test.describe("composer + menu — real InputBar in isolation", () => {
	test("a surface wiring ONLY attach still gets the dropdown", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		// Nothing is open until the "+" is clicked.
		await expect(
			page.getByRole("button", { name: "Files and images" })
		).toHaveCount(0);

		await plusIn(page, "minimal").click();

		// The affordance is a menu, not a straight-to-file-dialog button.
		await expect(
			page.getByRole("button", { name: "Files and images" })
		).toBeVisible();
	});

	test("the attach row inside the menu reaches the host handler", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		await expect(page.getByTestId("attach-count")).toHaveText("0");

		await plusIn(page, "minimal").click();
		await page.getByRole("button", { name: "Files and images" }).click();

		await expect(page.getByTestId("attach-count")).toHaveText("1");
	});

	test("the richer surface opens the SAME menu, with its extra rows", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		await plusIn(page, "full").click();

		// Same attach row as the minimal surface — one affordance, not two designs.
		await expect(
			page.getByRole("button", { name: "Files and images" })
		).toBeVisible();
		// Plus what this host wired on top.
		await expect(
			page.getByRole("button", { name: "Temporary chat" })
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Double-check" })
		).toBeVisible();
	});

	test("a menu row drives its host toggle", async ({ page }) => {
		await page.goto(STORY_URL);
		await expect(page.getByTestId("ghost-state")).toHaveText("off");

		await plusIn(page, "full").click();
		await page.getByRole("button", { name: "Temporary chat" }).click();

		await expect(page.getByTestId("ghost-state")).toHaveText("on");
	});
});
