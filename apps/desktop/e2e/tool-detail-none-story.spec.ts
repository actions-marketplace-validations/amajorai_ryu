// Real-browser spec for Detail level "None" (`e2e/harness/
// tool-detail-none-story.{html,tsx}`), which renders the REAL `MessageList` over
// one fixture twice — once with the pref off, once on.
//
// The contract under test, in the order it matters:
//   1. no tool rows survive None — including the thinking traces and file edits
//      that arrive as tool parts;
//   2. a FAILED call still does, because a turn that died silently is worse than
//      a turn that shows one row;
//   3. a turn whose whole content was tool detail leaves NO empty row behind.
//
// (3) is the reason this is a browser spec and not a unit test. The transcript's
// rows are `MessageScrollerItem`s with `content-visibility:auto`; an empty one
// renders as nothing but still holds a scroll slot and a 10rem intrinsic-size
// placeholder, so "no tool rows are visible" passes while the transcript is full
// of gaps. Counting the emitted items, and asserting none of them is empty, is
// what actually catches that.

import { expect, test } from "@playwright/test";

const STORY_URL = "/tool-detail-none-story.html";
const ITEM = '[data-slot="message-scroller-item"]';

// Text unique to each fixture element (kept in step with MARKERS in the story).
const OPENING_TOOL_ONLY = "opening-scan.ts";
const SILENT_TOOL_ONLY = "silent-refactor.ts";
const FAILED_COMMAND = "deploy-to-prod.sh";
const PROSE = "The build passes on the current branch.";
// The Marker the transcript draws off `_interrupted` message metadata.
const INTERRUPTED = /Interrupted — this reply was cut off/;

test("with detail on, every turn renders, tool rows included", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	const pane = page.getByTestId("with-detail");
	await expect(pane.getByText(PROSE)).toBeVisible();

	// Five turns: the assistant-only opener plus four user prompts.
	await expect(pane.locator(ITEM)).toHaveCount(5);
	await expect(pane.getByText(SILENT_TOOL_ONLY).first()).toBeVisible();
	await expect(pane.getByText(OPENING_TOOL_ONLY).first()).toBeVisible();
});

test("at None the tool rows are gone but the prose and the failure stay", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	const pane = page.getByTestId("no-detail");

	await expect(pane.getByText(PROSE)).toBeVisible();
	// Turn status, not tool detail. That turn's ONLY part is a hidden tool call,
	// so if the interrupted flag were treated as detail the whole crashed turn —
	// notice included — would be gone.
	await expect(pane.getByText(INTERRUPTED)).toBeVisible();
	// A failed call is the one tool row None keeps.
	await expect(pane.getByText(FAILED_COMMAND).first()).toBeVisible();

	// Succeeded calls leave nothing behind at all.
	await expect(pane.getByText(SILENT_TOOL_ONLY)).toHaveCount(0);
	await expect(pane.getByText(OPENING_TOOL_ONLY)).toHaveCount(0);
});

test("a turn with nothing left to show is dropped, not left blank", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	const pane = page.getByTestId("no-detail");

	// The head turn (assistant-only, pure tool calls) has no user message to
	// carry it, so it goes entirely: four rows, not five.
	await expect(pane.locator(ITEM)).toHaveCount(4);

	// And not one of the survivors is an empty row. `content-visibility:auto`
	// means an offscreen item still reports a placeholder height, so emptiness is
	// judged on text, not on geometry — and asserted per item with a web-first
	// matcher rather than one `allTextContents()` snapshot, so a dev-server
	// reload mid-read retries instead of failing the run.
	for (let i = 0; i < 4; i += 1) {
		await expect(pane.locator(ITEM).nth(i)).not.toHaveText(/^\s*$/);
	}
});
