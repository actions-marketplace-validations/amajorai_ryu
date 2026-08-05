// apps/desktop/src/lib/release-notes.test.ts
//
// The fixture is the REAL v0.1.3 release body, verbatim from the GitHub API. It
// is the whole argument for this module existing: the update toast used to show
// this text as-is, so the user's first impression of an update was `### Install`,
// a pipe table and two fenced shell commands. Pin against the real thing, not a
// tidied-up sample — a synthetic body would not have the install section that
// makes up most of it.

import { describe, expect, it } from "bun:test";
import { parseInline, summarizeReleaseNotes } from "./release-notes.ts";

const V0_1_3 = `Built from commit \`386b482\`.

### Install

**Most people — the desktop app.** Download the installer for your OS from the assets below, or from https://ryuhq.com/download.

| macOS | Windows | Linux |
|---|---|---|
| \`.dmg\` (Apple Silicon) | \`.msi\` / \`.exe\` | \`.AppImage\` / \`.deb\` |

**Developers, self-hosters, servers — the headless stack** (\`ryu-core\`, \`ryu-gateway\`, \`ryu-cli\`) into \`~/.ryu/bin\`:

\`\`\`bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/amajorai/ryu/main/install.sh | sh
\`\`\`

Then \`ryu-cli\` — it starts a local Core on first run, no API key needed.

### Features

- quests overhaul, parallel web.search plugin, mesh networking settings, onboarding privacy (\`a7272cb\`)
- theme dither-kit, richer store catalog, academy questions, and app-store polish (\`e8be41f\`)

### Fixes

- **gateway**: allowlist the parallel plugin's two egress hosts (\`386b482\`)
- **release**: keep canary/nightly history, and stop losing changelogs (\`5d56516\`)

### Documentation

- **update**: correct release_version's account of how rolling tags are versioned (\`1e29270\`)

### Other changes

- **release**: 0.1.2 -> 0.1.3 (\`e163c88\`)

**Full changelog**: https://github.com/amajorai/ryu/compare/v0.1.2...v0.1.3`;

const flatten = (segments: { text: string }[]) =>
	segments.map((s) => s.text).join("");

describe("summarizeReleaseNotes", () => {
	const summary = summarizeReleaseNotes(V0_1_3);

	it("keeps the changelog headings and drops Install", () => {
		expect(summary).not.toBeNull();
		expect(summary?.sections.map((s) => s.title)).toEqual([
			"Features",
			"Fixes",
		]);
	});

	it("drops every construct a toast cannot render", () => {
		const text = (summary?.sections ?? [])
			.flatMap((s) => s.items.map(flatten))
			.join("\n");
		// Table rows, fenced code, the install prose and the bare install URL.
		expect(text).not.toContain("|");
		expect(text).not.toContain("curl -fsSL");
		expect(text).not.toContain("ryuhq.com/download");
		expect(text).not.toContain("```");
	});

	it("drops the provenance lead paragraph", () => {
		// "Built from commit `386b482`." is not a change, and the item budget is
		// only a handful of lines.
		const text = (summary?.sections ?? [])
			.flatMap((s) => s.items.map(flatten))
			.join("\n");
		expect(text).not.toContain("Built from commit");
	});

	it("strips the trailing commit sha from each bullet", () => {
		const first = summary?.sections[0]?.items[0];
		expect(flatten(first ?? [])).toBe(
			"quests overhaul, parallel web.search plugin, mesh networking settings, onboarding privacy"
		);
	});

	it("keeps the conventional-commit scope as an emphasised segment", () => {
		const fix = summary?.sections[1]?.items[0] ?? [];
		expect(fix[0]).toEqual({ text: "gateway", bold: true });
		expect(flatten(fix)).toBe(
			"gateway: allowlist the parallel plugin's two egress hosts"
		);
	});

	it("reports truncation so the UI can link the full notes", () => {
		expect(summary?.truncated).toBe(true);
	});

	it("caps the total number of bullets", () => {
		const count = (summary?.sections ?? []).reduce(
			(sum, s) => sum + s.items.length,
			0
		);
		expect(count).toBeLessThanOrEqual(4);
	});

	it("keeps prose when a small release has no headings at all", () => {
		const summarized = summarizeReleaseNotes(
			"Fixes a crash on launch when no node is configured."
		);
		expect(summarized?.sections[0]?.title).toBeNull();
		expect(flatten(summarized?.sections[0]?.items[0] ?? [])).toBe(
			"Fixes a crash on launch when no node is configured."
		);
		expect(summarized?.truncated).toBe(false);
	});

	it("returns null when there is nothing to say", () => {
		// The callers substitute their own one-liner — a toast with an empty body
		// reads as a rendering bug.
		expect(summarizeReleaseNotes(null)).toBeNull();
		expect(summarizeReleaseNotes("")).toBeNull();
		expect(summarizeReleaseNotes("   \n\n")).toBeNull();
		expect(summarizeReleaseNotes("### Install\n\nDownload it.")).toBeNull();
	});

	it("clips a long bullet rather than overflowing the toast", () => {
		const long = `- ${"word ".repeat(80)}`;
		const clipped = flatten(
			summarizeReleaseNotes(long)?.sections[0]?.items[0] ?? []
		);
		expect(clipped.length).toBeLessThanOrEqual(141);
		expect(clipped.endsWith("…")).toBe(true);
	});
});

describe("parseInline", () => {
	it("types bold, code and link segments", () => {
		expect(parseInline("a **b** `c` [d](https://e)")).toEqual([
			{ text: "a " },
			{ text: "b", bold: true },
			{ text: " " },
			{ text: "c", code: true },
			{ text: " " },
			{ text: "d" },
		]);
	});

	it("leaves plain text alone", () => {
		expect(parseInline("nothing to mark up")).toEqual([
			{ text: "nothing to mark up" },
		]);
	});
});
