// apps/desktop/src/lib/app-version.test.ts
//
// Pins the comparison that decides whether an update verdict is about THIS APP.
//
// Two failure modes, in opposite directions, and both have shipped before:
//   - too permissive → the reported bug: an app on 0.1.3 told "Update available
//     — v0.1.3" because a stale `~/.ryu/bin/ryu-core` answered the check;
//   - too strict → a silently inert release channel, which is what Core's own
//     `parse_version` doc records happening when the prerelease was discarded
//     (every nightly compared equal to every other, so nobody ever moved).
// The prerelease cases below are the ones that separate the two.

import { describe, expect, it } from "bun:test";
import { isNewerVersion, releaseIsNewerThanApp } from "./app-version.ts";

describe("isNewerVersion", () => {
	it("orders the numeric core", () => {
		expect(isNewerVersion("0.1.2", "0.1.3")).toBe(true);
		expect(isNewerVersion("0.1.3", "0.1.3")).toBe(false);
		expect(isNewerVersion("0.1.3", "0.1.2")).toBe(false);
		expect(isNewerVersion("0.9.9", "1.0.0")).toBe(true);
		// The exact case from the bug report: a stale 0.0.14 Core answering for an
		// 0.1.3 app. Core's verdict is true; the APP's answer must be false.
		expect(isNewerVersion("0.0.14", "0.1.3")).toBe(true);
	});

	it("tolerates a leading v and surrounding space", () => {
		expect(isNewerVersion(" v0.1.2 ", "v0.1.3")).toBe(true);
		expect(isNewerVersion("V0.1.3", "0.1.3")).toBe(false);
	});

	it("pads a short version", () => {
		expect(isNewerVersion("1", "1.0.1")).toBe(true);
		expect(isNewerVersion("1.2", "1.2.0")).toBe(false);
	});

	it("ignores build metadata (semver §10)", () => {
		// Two builds differing only by +sha are the same release. Core hit this as
		// a real bug — the `semver` crate's Ord compares build metadata.
		expect(isNewerVersion("0.1.3", "0.1.3+abc1234")).toBe(false);
		expect(isNewerVersion("0.1.3+abc1234", "0.1.3")).toBe(false);
	});

	it("ranks a prerelease below its own stable (semver §11)", () => {
		expect(isNewerVersion("0.1.3-nightly.20260804.24", "0.1.3")).toBe(true);
		expect(isNewerVersion("0.1.3", "0.1.3-nightly.20260804.24")).toBe(false);
	});

	it("orders two builds on the same rolling channel", () => {
		// The whole point of keeping the prerelease: consecutive nightlies differ
		// in nothing else, so discarding it freezes the channel.
		expect(
			isNewerVersion("0.1.2-nightly.20260804.24", "0.1.2-nightly.20260805.25")
		).toBe(true);
		expect(
			isNewerVersion("0.1.2-nightly.20260805.25", "0.1.2-nightly.20260804.24")
		).toBe(false);
	});

	it("compares prerelease identifiers per §11", () => {
		// Numeric identifiers compare numerically, not as strings.
		expect(isNewerVersion("1.0.0-beta.2", "1.0.0-beta.10")).toBe(true);
		// Numeric ranks below alphanumeric.
		expect(isNewerVersion("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBe(true);
		// A longer identifier list wins when every shared one is equal.
		expect(isNewerVersion("1.0.0-alpha", "1.0.0-alpha.1")).toBe(true);
	});

	it("fails safe on unparseable input", () => {
		// A malformed release tag must never trigger an update…
		expect(isNewerVersion("0.1.3", "not-a-version")).toBe(false);
		// …but a corrupt install can still recover onto a real release.
		expect(isNewerVersion("garbage", "0.1.3")).toBe(true);
		expect(isNewerVersion("1.2.3.4", "0.1.3")).toBe(true);
	});
});

describe("releaseIsNewerThanApp", () => {
	it("defers to Core's verdict when the app version is unknown", () => {
		// No Tauri shell (browser dev server, e2e harness). Unknown must never read
		// as "up to date" — that would suppress every update outside the bundle.
		expect(releaseIsNewerThanApp(null, "0.1.3")).toBe(true);
		expect(releaseIsNewerThanApp(undefined, "0.1.3")).toBe(true);
	});

	it("suppresses a release the app already is", () => {
		expect(releaseIsNewerThanApp("0.1.3", "0.1.3")).toBe(false);
	});

	it("keeps a genuine upgrade", () => {
		expect(releaseIsNewerThanApp("0.1.2", "0.1.3")).toBe(true);
	});

	it("defers across channels, so the channel picker is not inert", () => {
		// A stable 0.1.3 outranks 0.1.3-nightly.x by precedence, so gating on
		// semver alone would make "switch to nightly" do nothing.
		expect(releaseIsNewerThanApp("0.1.3", "0.1.3-nightly.20260805.25")).toBe(
			true
		);
		expect(releaseIsNewerThanApp("0.1.3-beta.1", "0.1.3")).toBe(true);
	});

	it("still compares within one rolling channel", () => {
		expect(
			releaseIsNewerThanApp(
				"0.1.2-nightly.20260805.25",
				"0.1.2-nightly.20260804.24"
			)
		).toBe(false);
	});
});
