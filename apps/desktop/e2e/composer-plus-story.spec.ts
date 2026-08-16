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
			page.getByRole("option", { name: "Files and images" })
		).toHaveCount(0);

		await plusIn(page, "minimal").click();

		// The affordance is a menu, not a straight-to-file-dialog button.
		await expect(
			page.getByRole("option", { name: "Files and images" })
		).toBeVisible();
	});

	test("the attach row inside the menu reaches the host handler", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		await expect(page.getByTestId("attach-count")).toHaveText("0");

		await plusIn(page, "minimal").click();
		await page.getByRole("option", { name: "Files and images" }).click();

		await expect(page.getByTestId("attach-count")).toHaveText("1");
	});

	test("the shared menu searches apps from the textarea and inserts a tag", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		const mount = page.getByTestId("minimal");
		await plusIn(page, "minimal").click();
		await expect(page.getByRole("option", { name: /Calendar/ })).toBeVisible();

		await mount.locator("textarea").fill("cal");
		await expect(page.getByRole("option", { name: /Calendar/ })).toBeVisible();
		await expect(page.getByRole("option", { name: /Proof/ })).toHaveCount(0);
		await page.getByRole("option", { name: /Calendar/ }).click();

		await expect(mount.locator("textarea")).toHaveValue("@Calendar ");
	});

	test("the richer surface opens the SAME menu, with its extra rows", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		await plusIn(page, "full").click();

		// Same attach row as the minimal surface — one affordance, not two designs.
		await expect(
			page.getByRole("option", { name: "Files and images" })
		).toBeVisible();
		// Plus what this host wired on top.
		await expect(
			page.getByRole("option", { name: "Temporary chat" })
		).toBeVisible();
		await expect(
			page.getByRole("option", { name: "Double-check" })
		).toBeVisible();
	});

	// The compact composer's TOPOLOGY, not its "+" menu. `compact` used to select a
	// second layout in which the textarea sat BETWEEN the "+" and the trailing
	// controls on one line, so once a chat had history the "+" and the agent
	// selector jumped out of the stacked controls row and landed on opposite sides
	// of the bar. Both spellings compile and both render; only a laid-out browser
	// can tell them apart, which is why this is pinned here.
	test("compact keeps the + and the agent selector in one row BELOW the textarea", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		const mount = page.getByTestId("compact");
		const plus = plusIn(page, "compact");
		const agent = mount.getByTestId("agent-trigger");
		const textarea = mount.locator("textarea");

		await expect(plus).toBeVisible();
		await expect(agent).toBeVisible();

		const [plusBox, agentBox, textareaBox] = await Promise.all([
			plus.boundingBox(),
			agent.boundingBox(),
			textarea.boundingBox(),
		]);
		if (!(plusBox && agentBox && textareaBox)) {
			throw new Error("composer controls did not lay out");
		}

		// Same row: their vertical centres line up (the single-row layout put them
		// on the same line as each other too, which is why the textarea test below
		// is the one that actually distinguishes the two).
		const plusCentre = plusBox.y + plusBox.height / 2;
		const agentCentre = agentBox.y + agentBox.height / 2;
		expect(Math.abs(plusCentre - agentCentre)).toBeLessThan(4);

		// Stacked: the controls row starts below the textarea's bottom edge. In the
		// deleted single-row layout the textarea shared their line, so this failed.
		expect(plusBox.y).toBeGreaterThanOrEqual(
			textareaBox.y + textareaBox.height
		);

		// Left-aligned, in order: "+" then the agent selector — the launchpad's
		// arrangement, which compact used to invert (agent selector on the right).
		expect(agentBox.x).toBeGreaterThan(plusBox.x);

		await plus.click();
		const menuBox = await page.getByRole("listbox").boundingBox();
		if (!menuBox) {
			throw new Error("composer menu did not lay out");
		}
		expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(plusBox.y);
	});

	test("shows current-turn plan and file details above the composer", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		await expect(
			page.getByRole("button", { name: "Step 2 / 3" })
		).toBeVisible();
		const filesButton = page.getByRole("button", { name: /2 files changed/ });
		await expect(filesButton).toBeVisible();
		await expect(filesButton).toContainText("+18");
		await expect(filesButton).toContainText("-3");

		await page.getByRole("button", { name: "Step 2 / 3" }).click();
		await expect(page.getByText("Verify", { exact: true })).toBeVisible();
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: /2 files changed/ }).click();
		await expect(page.getByText("src/composer.tsx")).toBeVisible();
	});

	// The roomy textarea block's vertical rhythm. It used to pin its content with
	// `pt-3` against a 56px floor, which put a 22px line 12px from the top and left
	// twice that below it — the caret sat visibly high in an apparently empty box.
	// A padding value is a number a build cannot judge; the laid-out gap is.
	test("the roomy textarea sits centred in its block, not pinned to the top", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		const textarea = page.getByTestId("minimal").locator("textarea");
		await expect(textarea).toBeVisible();
		// The block is the textarea's own padded wrapper.
		const block = textarea.locator("xpath=..");

		const [textareaBox, blockBox] = await Promise.all([
			textarea.boundingBox(),
			block.boundingBox(),
		]);
		if (!(textareaBox && blockBox)) {
			throw new Error("composer textarea did not lay out");
		}

		const above = textareaBox.y - blockBox.y;
		const below =
			blockBox.y + blockBox.height - (textareaBox.y + textareaBox.height);
		// Symmetric within a pixel of rounding; the old fixed pad was ~10px out.
		expect(Math.abs(above - below)).toBeLessThanOrEqual(2);
		// And the block still keeps its roomy floor.
		expect(blockBox.height).toBeGreaterThanOrEqual(55);
	});

	test("a menu row drives its host toggle", async ({ page }) => {
		await page.goto(STORY_URL);
		await expect(page.getByTestId("ghost-state")).toHaveText("off");

		await plusIn(page, "full").click();
		await page.getByRole("option", { name: "Temporary chat" }).click();

		await expect(page.getByTestId("ghost-state")).toHaveText("on");
	});
});
