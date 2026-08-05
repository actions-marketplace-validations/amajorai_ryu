// Real-browser spec for the "update available" toast
// (`e2e/harness/update-toast-story.{html,tsx}`), which fires the REAL sileo
// `Toaster` with the REAL `updateToastBody(...)` over the real v0.1.3 release
// body.
//
// What this covers that a unit test cannot: the toast used to receive
// `verdict.notes` as a plain string, so the user's first sight of an update was
// the markdown SOURCE — `### Install`, a `| macOS | Windows |` table and two
// fenced `curl … | sh` blocks. The summariser + renderer are unit-tested
// (`src/lib/release-notes.test.ts`), but "does sileo actually SHOW this" is a
// browser question: the shared wrapper drives an autopilot expand/collapse cycle
// and a toast is laid out for a one-line description. So the assertions below are
// about what is on screen, not about what the summariser returned.

import { expect, test } from "@playwright/test";

// The story pulls the ui package's toast module graph; vite compiles it on first
// navigation, so allow headroom over the 30s default.
test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/update-toast-story.html";

// sileo slides the toast in and runs an autopilot EXPAND before it settles, so a
// geometry read taken the moment the title becomes visible measures the toast
// mid-animation — still below the fold. Every assertion here waits for the
// settled state.
const SETTLE_MS = 1200;

async function showToast(page: import("@playwright/test").Page) {
	await page.goto(STORY_URL);
	await page.getByTestId("show-toast").click();
	await expect(page.getByText("Update available — v0.1.3")).toBeVisible();
	await page.waitForTimeout(SETTLE_MS);
}

test.describe("update-available toast", () => {
	test("shows the changelog, not the markdown source", async ({ page }) => {
		await showToast(page);
		// The two headings that describe what changed, and one bullet under each.
		await expect(page.getByText("Features", { exact: true })).toBeVisible();
		await expect(page.getByText("Fixes", { exact: true })).toBeVisible();
		await expect(
			page.getByText("allowlist the parallel plugin's two egress hosts")
		).toBeVisible();
		// Capped at two sections — a toast that lists everything is the raw-markdown
		// problem again in a nicer font.
		await expect(page.getByText("Documentation", { exact: true })).toHaveCount(
			0
		);
	});

	test("drops the install boilerplate the body is mostly made of", async ({
		page,
	}) => {
		await showToast(page);
		const body = await page.locator("body").innerText();
		// Heading markers, the table, the fenced install commands, the download URL
		// and the trailing commit shas — every one of them used to be on screen.
		expect(body).not.toContain("### ");
		expect(body).not.toContain("| macOS |");
		expect(body).not.toContain("curl -fsSL");
		expect(body).not.toContain("```");
		expect(body).not.toContain("ryuhq.com/download");
		expect(body).not.toContain("(`386b482`)");
		// `**gateway**` renders as emphasis, so the asterisks are gone from the text.
		expect(body).not.toContain("**");
	});

	test("stays expanded and readable rather than collapsing to one line", async ({
		page,
	}) => {
		await showToast(page);
		const bullet = page.getByText(
			"allowlist the parallel plugin's two egress hosts"
		);
		// A collapsed/clipped toast still has the node in the DOM, so assert the
		// rendered geometry of the SETTLED toast: real height, fully on screen.
		const box = await bullet.boundingBox();
		expect(box).not.toBeNull();
		expect(box?.height ?? 0).toBeGreaterThan(0);
		const viewport = page.viewportSize();
		expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
		expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
			viewport?.height ?? 0
		);
		// The description survives the autopilot collapse window (the wrapper pushes
		// collapse to end-of-life, and this toast has `duration: null`).
		await page.waitForTimeout(3000);
		await expect(bullet).toBeVisible();
	});

	test("offers the full release notes when the summary is clipped", async ({
		page,
	}) => {
		await showToast(page);
		const link = page.getByRole("link", { name: "Full release notes" });
		await expect(link).toBeVisible();
		await expect(link).toHaveAttribute(
			"href",
			"https://github.com/amajorai/ryu/releases/tag/v0.1.3"
		);
		// The install action keeps sileo's single button slot; the notes escape is
		// the inline link above.
		await expect(
			page.getByRole("button", { name: "Update now" })
		).toBeVisible();
	});
});
