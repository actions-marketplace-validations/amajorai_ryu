import { expect, test } from "@playwright/test";

const STORY_URL = "/browser-annotation-proof.html";

test.describe.configure({ mode: "serial", timeout: 60_000 });

test("annotation mode opens only after a real visual selection", async ({
	page,
}) => {
	await page.goto(STORY_URL, { waitUntil: "domcontentloaded" });
	const surface = page.getByTestId("browser-annotation-surface");
	await expect(surface).toBeVisible();
	await expect(
		surface.getByRole("textbox", { name: "Annotation comment" })
	).toHaveCount(0);

	const frame = page.getByTestId("browser-annotation-frame");
	const box = await frame.boundingBox();
	expect(box).not.toBeNull();
	if (!box) {
		return;
	}
	await page.mouse.move(box.x + 90, box.y + 180);
	await page.mouse.down();
	await page.mouse.move(box.x + 420, box.y + 350);
	await page.mouse.up();

	await expect(
		surface.getByRole("textbox", { name: "Annotation comment" })
	).toBeVisible();
});

test("annotation notes preserve styling controls and a saved overlay", async ({
	page,
}) => {
	await page.goto(STORY_URL, { waitUntil: "domcontentloaded" });
	const surface = page.getByTestId("browser-annotation-surface");
	const frame = page.getByTestId("browser-annotation-frame");
	const box = await frame.boundingBox();
	expect(box).not.toBeNull();
	if (!box) {
		return;
	}
	await page.mouse.move(box.x + 90, box.y + 180);
	await page.mouse.down();
	await page.mouse.move(box.x + 420, box.y + 350);
	await page.mouse.up();

	await surface
		.getByRole("textbox", { name: "Annotation comment" })
		.fill("Make the hero action clearer and keep the supporting copy compact.");
	await surface.getByRole("button", { name: "Adjust styling" }).click();
	await expect(surface.getByText("Font size")).toBeVisible();
	await surface.getByRole("button", { name: "Add note" }).click();
	await expect(
		surface.getByTestId("browser-annotation-marker-2")
	).toBeVisible();

	await surface.getByRole("button", { name: "Annotation mode on" }).click();
	await expect(
		surface.getByText(
			"Make the hero action clearer and keep the supporting copy compact."
		)
	).toBeVisible();
});
