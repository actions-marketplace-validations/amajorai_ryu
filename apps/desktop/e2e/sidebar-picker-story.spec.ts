// Real-browser spec for the sidebar scope-picker story (`e2e/harness/
// sidebar-picker-story.{html,tsx}`), which mounts the REAL `SidebarScopePicker`,
// `SidebarChatList` and `SpacesPickerBody` — the primitives behind "Projects &
// Spaces as pickers" and behind date grouping applying to lists other than Chats.
//
// What it certifies, none of which a type-check or the pure bucketing unit test
// (`src/lib/sidebar/date-buckets.test.ts`) can see:
//   • the picker's default option is the AGGREGATE ("All projects"), and every
//     project's chats are listed under it — the decluttered default;
//   • picking one project narrows the list to that project's chats, which is a
//     fact about a Base UI `Select` rendering its popup in a portal;
//   • with "Group lists by date" ON, the chats sit under real date-bucket
//     headers (Today / Yesterday / Last week) rather than in one flat run;
//   • a bucket header collapses its own chats and leaves the others alone;
//   • collapse state stays with the scope it was set in — the regression the
//     per-scope storage keys could not prevent on their own (see that case);
//   • with the preference OFF the headers are gone entirely — the setting is a
//     render decision, not decoration;
//   • "All spaces" really is a per-space fan-out, and space documents bucket by
//     `createdAt` (the only stamp on the wire) rather than landing in "Undated".

import { expect, test } from "@playwright/test";

// The story pulls the full AppSidebar module graph; vite compiles it on first
// navigation, so allow headroom over the 30s default for cold-start CI runs.
test.describe.configure({ timeout: 90_000 });

const GROUPED_URL = "/sidebar-picker-story.html";
const FLAT_URL = "/sidebar-picker-story.html?group=off";
const SPACES_URL = "/sidebar-picker-story.html?view=spaces";

/** A date-bucket header — a `SubSection` header button carrying the label. */
function bucket(page: import("@playwright/test").Page, label: string) {
	return page.locator("button", { hasText: label }).first();
}

/** Pick a scope through the real Base UI select (its list is portalled). */
async function selectOption(
	page: import("@playwright/test").Page,
	name: string
) {
	await page.getByRole("combobox").click();
	await page.getByRole("option", { name, exact: true }).click();
}

test.describe("sidebar scope picker — real components in isolation", () => {
	test("defaults to the aggregate scope and lists every project's chats", async ({
		page,
	}) => {
		await page.goto(GROUPED_URL);
		await expect(page.getByTestId("selection")).toHaveText("all");
		// The trigger names the aggregate, not the first project.
		await expect(page.getByRole("combobox")).toContainText("All projects");
		for (const title of [
			"Alpha today",
			"Alpha yesterday",
			"Beta today",
			"Beta last week",
		]) {
			await expect(page.getByText(title, { exact: true })).toBeVisible();
		}
	});

	test("picking one project narrows the list to its chats", async ({
		page,
	}) => {
		await page.goto(GROUPED_URL);
		await expect(page.getByText("Beta today", { exact: true })).toBeVisible();

		await page.getByRole("combobox").click();
		await page.getByRole("option", { name: "alpha" }).click();

		await expect(page.getByTestId("selection")).toHaveText("/Users/dev/alpha");
		await expect(page.getByText("Alpha today", { exact: true })).toBeVisible();
		await expect(
			page.getByText("Alpha yesterday", { exact: true })
		).toBeVisible();
		// Beta's chats are gone — the picker is a filter, not a label.
		await expect(page.getByText("Beta today", { exact: true })).toHaveCount(0);
		await expect(page.getByText("Beta last week", { exact: true })).toHaveCount(
			0
		);
	});

	test("groups the chats under date buckets when the preference is on", async ({
		page,
	}) => {
		await page.goto(GROUPED_URL);
		await expect(bucket(page, "Today")).toBeVisible();
		await expect(bucket(page, "Yesterday")).toBeVisible();
		await expect(bucket(page, "Last week")).toBeVisible();
		// Nothing was back-dated into a bucket it does not belong in.
		await expect(bucket(page, "Undated")).toHaveCount(0);
	});

	test("a bucket header collapses only its own chats", async ({ page }) => {
		await page.goto(GROUPED_URL);
		await expect(
			page.getByText("Alpha yesterday", { exact: true })
		).toBeVisible();

		await bucket(page, "Yesterday").click();

		await expect(
			page.getByText("Alpha yesterday", { exact: true })
		).toHaveCount(0);
		// Today's chats are untouched — collapse state is per bucket.
		await expect(page.getByText("Alpha today", { exact: true })).toBeVisible();
		await expect(page.getByText("Beta today", { exact: true })).toBeVisible();
	});

	test("renders one flat list when the preference is off", async ({ page }) => {
		await page.goto(FLAT_URL);
		// Same chats…
		await expect(page.getByText("Alpha today", { exact: true })).toBeVisible();
		await expect(
			page.getByText("Beta last week", { exact: true })
		).toBeVisible();
		// …no bucket headers.
		await expect(bucket(page, "Today")).toHaveCount(0);
		await expect(bucket(page, "Yesterday")).toHaveCount(0);
		await expect(bucket(page, "Last week")).toHaveCount(0);
	});

	// The regression the per-scope storage keys exist to prevent, and which they did
	// NOT prevent on their own: `useNestedSections` loads both keys in `useState`
	// initializers, and `DateGroupedRows` holds its tree position across a scope
	// change, so without a remount the buckets carried the old scope's collapse set
	// and the next toggle wrote it to the new scope's key.
	test("collapse state stays with the scope it was set in", async ({
		page,
	}) => {
		await page.goto(GROUPED_URL);
		await selectOption(page, "alpha");
		await expect(
			page.getByText("Alpha yesterday", { exact: true })
		).toBeVisible();

		await bucket(page, "Yesterday").click();
		await expect(
			page.getByText("Alpha yesterday", { exact: true })
		).toHaveCount(0);

		// Beta's Yesterday must be untouched — it is a different scope.
		await selectOption(page, "beta");
		await expect(
			page.getByText("Beta yesterday", { exact: true })
		).toBeVisible();

		// …and alpha's collapse survives the round trip rather than being clobbered
		// by beta's expanded state.
		await selectOption(page, "alpha");
		await expect(
			page.getByText("Alpha yesterday", { exact: true })
		).toHaveCount(0);
		await expect(page.getByText("Alpha today", { exact: true })).toBeVisible();
	});
});

test.describe("spaces picker body — real component in isolation", () => {
	test("the aggregate fans out one request per space and lists them all", async ({
		page,
	}) => {
		await page.goto(SPACES_URL);
		// Documents from BOTH spaces, which is the whole claim of "All spaces" —
		// Core has no cross-space endpoint, so this is a per-space fan-out.
		await expect(
			page.getByText("Note from today", { exact: true })
		).toBeVisible();
		await expect(page.getByText("receipt.pdf", { exact: true })).toBeVisible();
		await expect(page.getByTestId("requested")).toHaveText(
			"sp-notes,sp-uploads"
		);
	});

	test("space documents honour date grouping too", async ({ page }) => {
		await page.goto(SPACES_URL);
		await expect(bucket(page, "Today")).toBeVisible();
		await expect(bucket(page, "Yesterday")).toBeVisible();
		// Page rows carry their latest edit time, with creation as the legacy fallback;
		// an unstamped read would land every row in "Undated".
		await expect(bucket(page, "Undated")).toHaveCount(0);
	});

	test("narrowing to one space re-fetches just that space", async ({
		page,
	}) => {
		await page.goto(SPACES_URL);
		await expect(page.getByText("receipt.pdf", { exact: true })).toBeVisible();

		await selectOption(page, "Notes");

		await expect(
			page.getByText("Note from today", { exact: true })
		).toBeVisible();
		await expect(page.getByText("receipt.pdf", { exact: true })).toHaveCount(0);
		// The narrowed scope asked for exactly its own space, appended to the
		// aggregate's two.
		await expect(page.getByTestId("requested")).toHaveText(
			"sp-notes,sp-uploads,sp-notes"
		);
	});
});
