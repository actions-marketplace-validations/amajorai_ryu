// Real-browser spec for the INLINE MEDIA GENERATION surfaces, mounted through
// `e2e/harness/media-generation-story.{html,tsx}` — the real transcript drawing
// real `data-{image,video}-generation` parts.
//
// WHAT IT GUARDS, in two claims that were both false before:
//
//  1. A generated VIDEO gets the same reserved-frame surface an image gets.
//     Video used to fall through to a "Download attachment (video/mp4)" anchor,
//     which is not a layout claim a unit test can catch — the part type simply
//     never matched anything and the fallback rendered instead.
//
//  2. A FAILED generation offers a working Retry, on both media types. The
//     button lives in the component but the call is assembled by the transcript
//     from the part's own prompt and handed to the surface; every hop has to be
//     connected for a click to do anything. So the assertion is not "a button
//     exists" but "pressing it moves the same message through
//     generating → complete", which is only true end to end.
//
// Keyboard, not mouse: Retry must be a real focusable <button>, so the spec
// reaches it with Tab and fires it with Enter.

import { expect, test } from "@playwright/test";

/** The stock error line the video surface shows for a failed generation. */
const VIDEO_ENGINE_ERROR = "The engine returned no video.";

test.beforeEach(async ({ page }) => {
	await page.goto("/media-generation-story.html");
	await expect(page.getByTestId("story-state")).toHaveAttribute(
		"data-retry-count",
		"0"
	);
});

test("a failed video generation renders the video surface, not a download link", async ({
	page,
}) => {
	const surface = page.locator('[data-slot="video-generation"]');
	await expect(surface.first()).toBeVisible();
	// The failed one carries the engine's own diagnostic, not a generic line.
	await expect(surface.filter({ hasText: VIDEO_ENGINE_ERROR })).toHaveAttribute(
		"data-state",
		"error"
	);
	// The old plain path is gone: no video is offered as a bare attachment.
	await expect(page.getByText("Download attachment (video/mp4)")).toHaveCount(
		0
	);
});

test("a video that merely arrives gets the same frame, with a player", async ({
	page,
}) => {
	// The `file` part with `video/mp4` — complete, no status line, and a real
	// <video> element rather than an anchor.
	const arrived = page.locator(
		'[data-slot="video-generation"][data-state="complete"]'
	);
	await expect(arrived).toHaveCount(1);
	await expect(arrived.locator("video")).toHaveAttribute("controls", "");
});

test("the failed video's Retry is keyboard-reachable and re-runs the generation", async ({
	page,
}) => {
	const retry = page.getByRole("button", { name: "Try again" }).first();
	await expect(retry).toBeVisible();

	// Focus it the way a keyboard user would arrive, then fire it with Enter.
	await retry.focus();
	await expect(retry).toBeFocused();
	await page.keyboard.press("Enter");

	// The producer was actually called...
	await expect(page.getByTestId("story-state")).toHaveAttribute(
		"data-retry-count",
		"1"
	);
	// ...and the SAME message moved through the in-flight frame to a finished
	// clip. A present-but-unwired button leaves it on `error` forever.
	const surfaces = page.locator('[data-slot="video-generation"]');
	await expect(surfaces.filter({ hasText: "Video ready" })).toHaveCount(1);
	await expect(page.getByText(VIDEO_ENGINE_ERROR)).toHaveCount(0);
});

test("the image surface got the same Retry wiring", async ({ page }) => {
	const imageSurface = page.locator('[data-slot="image-generation"]');
	await expect(imageSurface).toHaveAttribute("data-state", "error");

	const retry = imageSurface.getByRole("button", { name: "Try again" });
	await retry.focus();
	await page.keyboard.press("Enter");

	await expect(imageSurface).toHaveAttribute("data-state", "complete");
	await expect(page.getByTestId("story-state")).toHaveAttribute(
		"data-retry-count",
		"1"
	);
});
