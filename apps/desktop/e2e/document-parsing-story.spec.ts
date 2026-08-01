// Real-browser spec for the document-parsing story (`e2e/harness/
// document-parsing-story.{html,tsx}`), which mounts the REAL
// `DocumentParsingSettings` against byte-exact copies of what Core answers.
//
// This asserts the one thing no static check could: that the panel's rows are
// POPULATED. The panel shipped with its two reads pointed at a route Core did not
// register (`/api/documents/parse/capability`) and a route that had never existed
// (`/api/document-parse/backends`). Both failures are caught and swallowed by the
// component — deliberately, so an unreachable node does not blank the whole
// dialog — so the visible result was a panel with its chrome intact, no provider
// row, no capability readout, and no limit. Every assertion below is over a value
// that can only come from a response the node actually gave.
//
// Contract, from `DocumentParsingSettings.tsx`:
//   • the backend list comes from `/api/capabilities` filtered to `document.parse`
//     (enabled providers, plus installed-but-off ones under their own heading);
//   • the capability readout comes from `/api/documents/parse/capability` and
//     renders whenever the node ANSWERED — not only when a provider is bound;
//   • the upload-limit row prints the NODE's `max_input_bytes`, never a constant
//     compiled into the desktop.

import { expect, test } from "@playwright/test";

// The story pulls the settings + item + toast module graph; vite compiles it on
// first navigation, so allow headroom over the 30s default for cold-start runs.
test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/document-parsing-story.html";

test("the bound backend is listed and marked in use", async ({ page }) => {
	await page.goto(STORY_URL);
	// Comes from `/api/capabilities`. Before this change the read 404'd and the
	// panel claimed "No document parser is enabled on this node" instead.
	await expect(page.getByText("MarkItDown").first()).toBeVisible();
	await expect(page.getByText("@ryu/markitdown · v0.1.3")).toBeVisible();
	await expect(page.getByRole("button", { name: "In use" })).toBeVisible();
	await expect(
		page.getByText("No document parser is enabled on this node")
	).toHaveCount(0);
});

test("installed-but-disabled backends are named, not hidden", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	await expect(page.getByText("Installed but turned off")).toBeVisible();
	await expect(page.getByText(/Docling \(com\.ryu\.docling\)/)).toBeVisible();
});

test("the capability readout renders with the node's own values", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	// `exact` throughout: the panel's prose mentions "parser" and "ready" in
	// several sentences, and a substring match would go green on the copy while
	// the readout itself was missing — the exact failure this spec exists to catch.
	//
	// The parse facade's own name for what it resolved — a different claim from
	// the registry's "Bound" badge, and the row that was previously invisible.
	await expect(page.getByText("Parser", { exact: true })).toBeVisible();
	await expect(
		page.getByText("Reported status", { exact: true })
	).toBeVisible();
	await expect(page.getByText("ready", { exact: true })).toBeVisible();
	// 15 extensions in the stubbed capability response. A hardcoded list in the
	// desktop could not produce this number; only the node's answer can.
	await expect(
		page.getByText("Readable formats", { exact: true })
	).toBeVisible();
	await expect(page.getByText("15", { exact: true })).toBeVisible();
});

test("the built-in floor is stated with the node's own extension list", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	// `builtin_extensions` from the capability response, not the component's
	// fallback sentence — proving the read reached the render.
	await expect(
		page.getByText(/\.txt, \.md, \.markdown, \.csv, \.json, \.html/)
	).toBeVisible();
});

test("the upload limit row renders the node's reported ceiling", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	await expect(page.getByText("Maximum file you can upload")).toBeVisible();
	// 32 MiB = `max_input_bytes` in the stub = Core's `MAX_PARSE_BYTES`.
	await expect(page.getByText("32 MB")).toBeVisible();
	// The row must say the number came from the node. The fallback wording is
	// reserved for a failed read, and printing it here would mean the panel is
	// showing its compiled-in constant while claiming to show the node's.
	await expect(page.getByText(/Reported by this node/)).toBeVisible();
	await expect(page.getByText(/did not report its limit/)).toHaveCount(0);
});
