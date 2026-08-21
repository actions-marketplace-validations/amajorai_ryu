// Real-browser spec for the chat-scroll story (`e2e/harness/
// chat-scroll-story.{html,tsx}`), which mounts the REAL transcript with a history
// that arrives after mount — ChatPage's actual shape.
//
// The contract under test: opening a conversation lands on the NEWEST message,
// and the Appearance toggle ("Open chats at the latest message") is what decides
// that. Both halves need a real layout: the transcript's items are
// `content-visibility:auto`, so the scroll height at hydration time is an
// estimate that grows afterwards, and a background tab has no layout at all until
// it is revealed.

import { expect, type Locator, type Page, test } from "@playwright/test";

// Cold Vite compiles the whole transcript module graph on first navigation.
test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/chat-scroll-story.html";

/** How far from the true bottom still counts as "at the latest message". */
const BOTTOM_SLACK_PX = 4;

function viewport(page: Page): Locator {
	return page.locator('[data-slot="message-scroller-viewport"]');
}

async function distanceFromBottom(scroller: Locator): Promise<number> {
	return await scroller.evaluate(
		(el) => el.scrollHeight - el.clientHeight - el.scrollTop
	);
}

/** `TURN_COUNT * 2` in the story — a user + assistant message per turn. */
const HISTORY_MESSAGE_COUNT = "80";

async function waitForHistory(page: Page) {
	await expect(page.getByTestId("story-state")).toHaveAttribute(
		"data-message-count",
		HISTORY_MESSAGE_COUNT,
		// Cold Vite compiles the transcript graph on first navigation, which can
		// outlast the default 5s assertion timeout.
		{ timeout: 60_000 }
	);
}

/** Select a different chat in the already-mounted transcript and wait for its
 *  history to land. */
async function switchConversation(page: Page) {
	await page.getByTestId("switch-conversation").click();
	await expect(page.getByTestId("story-state")).toHaveAttribute(
		"data-thread",
		"conv-b",
		{ timeout: 30_000 }
	);
	await waitForHistory(page);
}

// Regression guard, not proof of the jump: measured against a build without it,
// a VISIBLE surface already settles at the end on its own. This fails if that
// ever regresses.
test("a conversation whose history lands after mount opens at the newest message", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	await waitForHistory(page);
	const scroller = viewport(page);

	// The transcript is genuinely taller than its viewport — otherwise "at the
	// bottom" would be true for free and this would assert nothing.
	await expect
		.poll(async () =>
			scroller.evaluate((el) => el.scrollHeight - el.clientHeight)
		)
		.toBeGreaterThan(500);

	await expect
		.poll(async () => await distanceFromBottom(scroller), {
			message: "transcript should settle at the end of the conversation",
		})
		.toBeLessThanOrEqual(BOTTOM_SLACK_PX);
});

test("a tab that hydrated while hidden jumps to the newest message once it gains layout", async ({
	page,
}) => {
	await page.goto(`${STORY_URL}?hidden=1`);
	await waitForHistory(page);
	// The history landed with the surface at `display:none`, so there was nothing
	// to scroll; revealing it is the first moment the jump can apply.
	await page.getByTestId("reveal").click();

	const scroller = viewport(page);
	await expect
		.poll(async () => await distanceFromBottom(scroller), {
			message: "revealed transcript should settle at the end",
		})
		.toBeLessThanOrEqual(BOTTOM_SLACK_PX);
});

test("selecting another chat in a live transcript opens that one at its newest message", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	await waitForHistory(page);
	await switchConversation(page);

	const scroller = viewport(page);
	await expect
		.poll(async () => await distanceFromBottom(scroller), {
			message: "the newly selected conversation should open at its end",
		})
		.toBeLessThanOrEqual(BOTTOM_SLACK_PX);
});

test("with the Appearance toggle off a tab that hydrated while hidden is left where it loaded", async ({
	page,
}) => {
	await page.goto(`${STORY_URL}?pref=off&hidden=1`);
	await waitForHistory(page);
	await page.getByTestId("reveal").click();

	const scroller = viewport(page);
	// The discriminating case. A transcript that hydrated with no layout has
	// nothing to scroll, and the scroller does not revisit that placement once the
	// surface appears — it opens at the START of the conversation. Only the
	// open-at-bottom jump moves it, so with the toggle off it must stay put.
	await page.waitForTimeout(500);
	expect(await distanceFromBottom(scroller)).toBeGreaterThan(BOTTOM_SLACK_PX);
});

test("scrolling to the top prepends an older message page and preserves the reading anchor", async ({
	page,
}, testInfo) => {
	await page.goto(`${STORY_URL}?paging=1`);

	await expect(page.getByTestId("story-state")).toHaveAttribute(
		"data-message-count",
		"20",
		{ timeout: 60_000 }
	);
	await expect(page.getByTestId("story-state")).toHaveAttribute(
		"data-page-start",
		"30"
	);

	const scroller = viewport(page);
	await expect
		.poll(async () =>
			scroller.evaluate((el) => el.scrollHeight - el.clientHeight)
		)
		.toBeGreaterThan(500);

	await scroller.evaluate((el) => {
		el.scrollTop = 0;
		el.dispatchEvent(new Event("scroll", { bubbles: true }));
	});

	await expect(page.getByTestId("story-state")).toHaveAttribute(
		"data-message-count",
		"40",
		{ timeout: 30_000 }
	);
	await expect(page.getByTestId("story-state")).toHaveAttribute(
		"data-page-start",
		"20"
	);
	await expect
		.poll(async () => scroller.evaluate((el) => el.scrollTop), {
			message:
				"prepending older messages should keep the previous top message in view",
		})
		.toBeGreaterThan(0);
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("chat-pagination-proof.png"),
	});
});
