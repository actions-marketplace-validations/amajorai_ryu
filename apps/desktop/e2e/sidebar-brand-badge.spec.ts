// Real-browser spec for the sidebar "Research Preview" pill's NOTCH, mounted
// through `e2e/harness/sidebar-brand-badge-story.{html,tsx}`.
//
// WHAT IT GUARDS. The pill is a speech bubble: three rounded corners and a square
// bottom-left. `BorderBeam` accepts one scalar radius and stamps it onto its own
// layers as `border-radius: Npx` AND `clip-path: inset(0 round Npx)`, so the
// traveling gradient traced a fully rounded outline around a notched shell — the
// bug this fixes. The cut therefore lives in CSS (`.beam-notch-bl`, src/index.css)
// and has to beat `[data-beam="<id>"][data-active]::after`, specificity (0,2,0). A
// bare class selector loses that cascade silently: the markup looks right, the
// corner stays round, and nothing fails.
//
// Both properties are load-bearing. Overriding `border-radius` alone leaves the
// layer's own rounded `clip-path` behind and the corner is still soft, so each
// assertion checks the pair.
//
// A screenshot cannot discriminate a 0px corner from a 10px one on a 20px-tall
// element, which is why this reads computed pseudo-element styles instead.

import { expect, type Page, test } from "@playwright/test";

/** How Chromium serialises the notched inset once the override lands. */
const NOTCHED_CLIP = "inset(0px round 999px 999px 999px 0px)";

test.beforeEach(async ({ page }) => {
	await page.goto("/sidebar-brand-badge-story.html");
	await expect(page.getByText("Research Preview").first()).toBeVisible();
});

/** Corner radii + clip of one layer of a beam, as the browser computes them. */
async function layer(page: Page, selector: string, pseudo: string | null) {
	return await page.evaluate(
		({ sel, pseudoElement }) => {
			const element = document.querySelector(sel);
			if (!element) {
				throw new Error(`missing ${sel}`);
			}
			const style = getComputedStyle(element, pseudoElement ?? undefined);
			return {
				bottomLeft: style.borderBottomLeftRadius,
				clipPath: style.clipPath,
				topLeft: style.borderTopLeftRadius,
			};
		},
		{ sel: selector, pseudoElement: pseudo }
	);
}

/** The beam wrapper of the light-column badge — the element carrying `data-beam`. */
const BEAM = '[data-testid="badge-light"] [data-beam]';

test("the shell itself carries the square bottom-left", async ({ page }) => {
	const shell = await layer(page, `${BEAM} > div.beam-notch-bl`, null);
	expect(shell.bottomLeft).toBe("0px");
	expect(shell.topLeft).not.toBe("0px");
});

test("the traveling stroke follows the notch, not a pill", async ({ page }) => {
	const stroke = await layer(page, BEAM, "::after");
	// THE assertion: the beam's own generated radius is scalar, so a round
	// bottom-left here means the override lost on specificity.
	expect(stroke.bottomLeft).toBe("0px");
	expect(stroke.topLeft).not.toBe("0px");
	// Without this the parent's `overflow: hidden` still clips the old round shape.
	expect(stroke.clipPath).toBe(NOTCHED_CLIP);
});

test("the inner glow and the bloom follow it too", async ({ page }) => {
	for (const target of [
		await layer(page, BEAM, "::before"),
		await layer(page, `${BEAM} [data-beam-bloom]`, null),
	]) {
		expect(target.bottomLeft).toBe("0px");
		expect(target.clipPath).toBe(NOTCHED_CLIP);
	}
});

test("the control beam is still round — the check is not vacuous", async ({
	page,
}) => {
	// Same preset, no `.beam-notch-bl`. If THIS came back square the assertions
	// above would be measuring something other than the override.
	const stroke = await layer(
		page,
		'[data-testid="control"] [data-beam]',
		"::after"
	);
	expect(stroke.bottomLeft).not.toBe("0px");
	expect(stroke.clipPath).not.toBe(NOTCHED_CLIP);
});
