import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial", timeout: 120_000 });

const STORY_URL = "/availability-prompt-policy-story.html";
const PROOF_SCREENSHOT = "e2e/artifacts/availability-prompt-policy-proof.png";

test("keeps a pending question in the composer while Online", async ({
	page,
}) => {
	await page.setViewportSize({ height: 1000, width: 1440 });
	await page.goto(STORY_URL, { waitUntil: "domcontentloaded" });

	await expect(page.getByTestId("availability-status")).toHaveText("online");
	await expect(page.getByTestId("prompt-location")).toHaveText("Composer");
	await expect(page.locator('[data-composer-prompt="question"]')).toBeVisible();
	await expect(page.locator(".an-tool-question")).toHaveCount(0);
});

test("Away moves the question to the transcript without discarding it", async ({
	page,
}) => {
	await page.setViewportSize({ height: 1000, width: 1440 });
	await page.goto(STORY_URL, { waitUntil: "domcontentloaded" });

	await page.getByRole("button", { name: "Availability: Online" }).click();
	await expect(
		page.getByRole("menuitem", { name: "Online", exact: true })
	).toBeVisible();
	await page.getByRole("menuitem", { name: "Away", exact: true }).click();

	await expect(page.getByTestId("availability-status")).toHaveText("away");
	await expect(page.getByTestId("prompt-location")).toHaveText("Transcript");
	await expect(page.getByText("Away mode", { exact: true })).toBeVisible();
	await expect(page.locator('[data-composer-prompt="question"]')).toHaveCount(
		0
	);
	await expect(page.locator(".an-tool-question")).toBeVisible();
});

test("AFK detection returns Online when the window is focused again", async ({
	page,
}) => {
	await page.setViewportSize({ height: 1000, width: 1440 });
	await page.goto(STORY_URL, { waitUntil: "domcontentloaded" });

	await page.evaluate(() => window.dispatchEvent(new Event("blur")));
	await expect(page.getByTestId("availability-status")).toHaveText("away");

	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await expect(page.getByTestId("availability-status")).toHaveText("online");
});

test("status and AFK preferences persist and the final product proof is captured", async ({
	page,
}) => {
	const browserErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			browserErrors.push(message.text());
		}
	});
	await page.setViewportSize({ height: 1000, width: 1440 });
	await page.goto(STORY_URL, { waitUntil: "domcontentloaded" });

	await page.getByRole("button", { name: "Availability: Online" }).click();
	await page.getByRole("menuitem", { name: "Away", exact: true }).click();
	await expect(page.getByTestId("availability-status")).toHaveText("away");
	const afkDetection = page.locator(
		'[data-setting-id="general.chats.afk-detection"] [data-slot="switch"]'
	);
	await expect(afkDetection).toBeChecked();
	await afkDetection.click();
	await expect(afkDetection).not.toBeChecked();
	await expect
		.poll(() =>
			page.evaluate(() => localStorage.getItem("ryu:user-availability"))
		)
		.toContain('"afkDetectionEnabled":false');

	await page.getByRole("button", { name: "Availability: Away" }).click();
	await expect(
		page.getByRole("menuitem", { name: "Do not disturb", exact: true })
	).toBeVisible();
	await page.screenshot({
		animations: "disabled",
		fullPage: true,
		path: PROOF_SCREENSHOT,
	});
	expect(browserErrors, `browser errors: ${browserErrors.join(" | ")}`).toEqual(
		[]
	);
});
