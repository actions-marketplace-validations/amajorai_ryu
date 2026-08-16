import { expect, test } from "@playwright/test";

const STORY_URL = "/memory-dream-reflect-story.html";

test.beforeEach(async ({ page }) => {
	await page.route("**/api/memory/**", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (
			url.pathname === "/api/memory/dream/review" &&
			request.method() === "GET"
		) {
			await route.fulfill({
				contentType: "application/json",
				body: JSON.stringify({
					proposals: [
						{
							created_at: 1,
							current: { content: "Likes long answers", id: "current-1" },
							id: "proposal-1",
							proposed: {
								category: "preference",
								content: "Prefers concise answers",
								id: "proposal-memory-1",
								importance: 4,
								scope: "user",
								tags: ["writing"],
							},
							reason: "You repeated this preference in two conversations.",
							source: "Recent conversations",
						},
					],
				}),
			});
			return;
		}
		if (url.pathname === "/api/memory/dream/review/settings") {
			await route.fulfill({
				contentType: "application/json",
				body: JSON.stringify({
					settings: {
						automatic: false,
						quiet_hours_end: 8,
						quiet_hours_start: 22,
					},
				}),
			});
			return;
		}
		if (
			url.pathname === "/api/memory/dream/review/proposals/proposal-1/accept"
		) {
			await route.fulfill({
				contentType: "application/json",
				body: JSON.stringify({
					memory: {
						content: "Prefers concise answers",
						id: "proposal-memory-1",
					},
				}),
			});
			return;
		}
		if (url.pathname === "/api/memory/reflect" && request.method() === "GET") {
			await route.fulfill({
				contentType: "application/json",
				body: JSON.stringify({
					activity: [
						{ count: 12, label: "Conversations", trend: 25 },
						{ count: 7, label: "Memories created", trend: null },
					],
					insights: [
						{
							body: "You made steady progress on writing this week.",
							id: "insight-1",
							title: "A focused week",
							tone: "positive",
						},
					],
					period: url.searchParams.get("period") ?? "7d",
					topics: [
						{
							count: 4,
							name: "Writing",
							summary: "Drafts and edits came up most often.",
						},
					],
				}),
			});
			return;
		}
		if (url.pathname === "/api/memory/reflect/settings") {
			await route.fulfill({
				contentType: "application/json",
				body: JSON.stringify({
					settings: {
						break_nudges: true,
						quiet_hours_enabled: true,
						quiet_hours_end: 8,
						quiet_hours_start: 22,
					},
				}),
			});
			return;
		}
		await route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({}),
		});
	});
});

test("Dream presents a diff and removes an accepted proposal", async ({
	page,
}) => {
	await page.goto(`${STORY_URL}?view=dream`);
	await expect(
		page.getByRole("heading", { name: "Dream review" })
	).toBeVisible();
	await expect(page.getByText("Likes long answers")).toBeVisible();
	await expect(page.getByText("Prefers concise answers")).toBeVisible();
	await expect(page.getByTestId("dream-proposal")).toHaveCount(1);
	await page.getByRole("button", { name: "Accept memory" }).click();
	await expect(page.getByText("No new memories to review")).toBeVisible();
});

test("Reflect shows dashboard cards and changes period", async ({ page }) => {
	await page.goto(`${STORY_URL}?view=reflect`);
	await expect(page.getByRole("heading", { name: "Reflect" })).toBeVisible();
	await expect(page.getByText("Conversations")).toBeVisible();
	await expect(page.getByText("Writing")).toBeVisible();
	await expect(page.getByText("A focused week")).toBeVisible();
	await page.getByRole("combobox", { name: "Reflect period" }).click();
	await page.getByRole("option", { name: "Last 30 days" }).click();
	await expect(
		page.getByRole("combobox", { name: "Reflect period" })
	).toContainText("Last 30 days");
});
