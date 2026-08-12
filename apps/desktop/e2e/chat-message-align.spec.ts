// Real-browser spec for how a USER turn sits in the transcript column
// (`packages/blocks/src/desktop/agent-elements/message-list.tsx`), reusing the
// chat-scroll story because it mounts the REAL `AgentChat` the way ChatPage does
// — including `currentUser`, so every user turn carries its avatar.
//
// Two edges are asserted, and neither can be read off the classnames:
//
//  1. The user avatar's right edge lands on the COMPOSER's right edge. The
//     transcript and the composer are two independently-padded columns
//     (`max-w-[744px] px-3` vs the input bar's `px-3` around `max-w-[720px]`);
//     they only agree because those numbers were matched on purpose. When the
//     transcript was `max-w-[720px] px-4` it sat 16px inside the composer on
//     each side, which reads as a gap to the right of the avatar.
//  2. The user turn's hover toolbar starts at the column's LEFT edge, the same
//     edge the assistant's own toolbar uses, rather than hugging the right
//     margin under the bubble.
//
// Both are checked at a wide and a narrow viewport: the columns are centered at
// wide widths and gutter-clamped at narrow ones, and only one of those is
// interesting if the padding ever drifts again.

import { expect, type Page, test } from "@playwright/test";

// Cold Vite compiles the whole transcript module graph on first navigation.
test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/chat-scroll-story.html";

/** `TURN_COUNT * 2` in the story — a user + assistant message per turn. */
const HISTORY_MESSAGE_COUNT = "80";

/** Sub-pixel rounding between two independently-laid-out columns. */
const EDGE_SLACK_PX = 1;

async function openStory(page: Page) {
	await page.goto(STORY_URL);
	await expect(page.getByTestId("story-state")).toHaveAttribute(
		"data-message-count",
		HISTORY_MESSAGE_COUNT,
		{ timeout: 60_000 }
	);
	// The last user turn is the one sitting directly above the composer, so it is
	// the pair the eye actually compares.
	await page.locator(".group\\/user-message").last().hover();
}

async function edges(page: Page) {
	return await page.evaluate(() => {
		const right = (el: Element | null | undefined) =>
			el ? el.getBoundingClientRect().right : Number.NaN;
		const left = (el: Element | null | undefined) =>
			el ? el.getBoundingClientRect().left : Number.NaN;
		const row = [...document.querySelectorAll(".group\\/user-message")].at(-1);
		const avatar = row?.querySelector('[data-slot="avatar"]');
		// The composer's own centered column — the box whose edges the transcript
		// is supposed to match.
		const composer = document.querySelector("textarea")?.closest("div.mx-auto");
		// First control in the user turn's hover toolbar.
		const toolbarButton = row?.lastElementChild?.querySelector("button");
		return {
			rowLeft: left(row),
			avatarRight: right(avatar),
			composerLeft: left(composer),
			composerRight: right(composer),
			toolbarButtonLeft: left(toolbarButton),
			hasAvatar: Boolean(avatar),
			hasToolbarButton: Boolean(toolbarButton),
		};
	});
}

for (const size of [
	{ name: "wide", width: 1280, height: 800 },
	{ name: "narrow", width: 520, height: 800 },
]) {
	test(`user turn shares the composer's edges (${size.name})`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: size.width, height: size.height });
		await openStory(page);
		const m = await edges(page);

		// Guard the selectors: a silently-missing avatar would make every edge
		// assertion below vacuously pass.
		expect(m.hasAvatar).toBe(true);
		expect(m.hasToolbarButton).toBe(true);

		expect(Math.abs(m.avatarRight - m.composerRight)).toBeLessThanOrEqual(
			EDGE_SLACK_PX
		);
		expect(Math.abs(m.rowLeft - m.composerLeft)).toBeLessThanOrEqual(
			EDGE_SLACK_PX
		);
		// Left-aligned actions: the first button starts at the column's left edge,
		// not somewhere out under the right-hand bubble.
		expect(Math.abs(m.toolbarButtonLeft - m.rowLeft)).toBeLessThanOrEqual(
			EDGE_SLACK_PX
		);
	});
}
