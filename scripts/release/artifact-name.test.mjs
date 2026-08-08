// scripts/release/artifact-name.test.mjs
//
//   node --test scripts/release/artifact-name.test.mjs
//
// The point of these tests is NOT that the names look nice. It is that the four
// suffixes the updater feed matches on, and the seven the marketing site's
// download resolver matches on, survive the rewrite — because every one of those
// consumers omits a miss rather than failing, so a broken rename ships green.

import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSuffixContract, rename, slugFor } from "./artifact-name.mjs";

const STABLE = "Ryu (Research Preview)";
const V = "0.1.7";

// The exact set the macOS/linux/windows legs produce, post arch-stamp.
const stableSet = () =>
	[
		`${STABLE}_${V}_aarch64.dmg`,
		`${STABLE}_${V}_x64.dmg`,
		`${STABLE}_${V}_x64_en-US.msi`,
		`${STABLE}_${V}_x64_en-US.msi.sig`,
		`${STABLE}_${V}_x64-setup.exe`,
		`${STABLE}_${V}_x64-setup.exe.sig`,
		`${STABLE}_${V}_amd64.AppImage`,
		`${STABLE}_${V}_amd64.AppImage.sig`,
		`${STABLE}_${V}_amd64.deb`,
		`${STABLE}_${V}_amd64.deb.sig`,
		`${STABLE}-${V}-1.x86_64.rpm`,
		`${STABLE}-${V}-1.x86_64.rpm.sig`,
		`${STABLE}-aarch64.app.tar.gz`,
		`${STABLE}-aarch64.app.tar.gz.sig`,
		`${STABLE}-x86_64.app.tar.gz`,
		`${STABLE}-x86_64.app.tar.gz.sig`,
	].map((n) => rename(n, STABLE, V));

test("slug carries product, surface and channel with no rewritable character", () => {
	assert.equal(slugFor(STABLE), "Ryu.Desktop.Research_Preview");
	assert.equal(slugFor("Ryu (Nightly)"), "Ryu.Desktop.Nightly");
	assert.equal(slugFor("Ryu"), "Ryu.Desktop");
	for (const s of [slugFor(STABLE), slugFor("Ryu (Nightly)"), slugFor("Ryu")]) {
		assert.ok(!/[ ()]/.test(s), `${s} still contains a space or paren`);
	}
});

test("the version already in the name is kept, not duplicated", () => {
	assert.equal(
		rename(`${STABLE}_${V}_aarch64.dmg`, STABLE, V),
		"Ryu.Desktop.Research_Preview.0.1.7_aarch64.dmg"
	);
	assert.equal(
		rename(`${STABLE}-${V}-1.x86_64.rpm`, STABLE, V),
		"Ryu.Desktop.Research_Preview.0.1.7-1.x86_64.rpm"
	);
});

test("the updater bundle has no version of its own, so one is inserted", () => {
	// This is the shape that would otherwise reach the release page as
	// `Ryu.Research.Preview.-aarch64.app.tar.gz` — branded, and versionless.
	assert.equal(
		rename(`${STABLE}-aarch64.app.tar.gz`, STABLE, V),
		"Ryu.Desktop.Research_Preview.0.1.7-aarch64.app.tar.gz"
	);
	assert.equal(
		rename(`${STABLE}-x86_64.app.tar.gz`, STABLE, V),
		"Ryu.Desktop.Research_Preview.0.1.7-x86_64.app.tar.gz"
	);
});

test("assemble-channel-feed's four platform matchers still resolve", () => {
	const out = stableSet();
	// Byte-identical to the greps in scripts/release/assemble-channel-feed.sh.
	const feed = {
		"darwin-aarch64": /-aarch64\.app\.tar\.gz$/,
		"darwin-x86_64": /-x86_64\.app\.tar\.gz$/,
		"linux-x86_64": /_amd64\.AppImage$/,
		"windows-x86_64": /_x64-setup\.exe$/,
	};
	for (const [key, re] of Object.entries(feed)) {
		const hits = out.filter((n) => re.test(n) && !n.endsWith(".sig"));
		assert.equal(hits.length, 1, `${key}: expected exactly one match, got ${hits.join(", ")}`);
	}
});

test("every artifact keeps a signature named exactly <artifact>.sig", () => {
	const out = stableSet();
	for (const sig of out.filter((n) => n.endsWith(".sig"))) {
		const parent = sig.slice(0, -4);
		assert.ok(out.includes(parent), `orphan ${sig}: no artifact named ${parent}`);
	}
});

test("the marketing site's download patterns still resolve", () => {
	const out = stableSet();
	// Byte-identical to PLATFORM_ASSET_PATTERNS in
	// packages/blocks/src/web/download-assets.ts.
	const site = {
		"macos/arm": [/aarch64\.dmg$/i, /_aarch64\.dmg$/i],
		"macos/intel": [/x64\.dmg$/i, /_x64\.dmg$/i],
		"windows/intel": [/x64-setup\.exe$/i, /x64_en-US\.msi$/i],
		"linux/intel": [/amd64\.AppImage$/i, /amd64\.deb$/i, /x86_64\.rpm$/i],
	};
	for (const [key, patterns] of Object.entries(site)) {
		assert.ok(
			patterns.some((re) => out.some((n) => re.test(n) && !n.endsWith(".sig"))),
			`${key}: no asset matches any of ${patterns}`
		);
	}
	// …and the companion-app exclusion must NOT swallow the desktop bundles.
	const nonDesktop = /^ryu-(island|browser|cli|core|gateway)[-_]/i;
	for (const n of out) {
		assert.ok(!nonDesktop.test(n), `${n} would be excluded as a non-desktop asset`);
	}
});

test("prerelease versions round-trip", () => {
	const nightly = "Ryu (Nightly)";
	const nv = "0.1.8-nightly.20260809.42";
	assert.equal(
		rename(`${nightly}_${nv}_amd64.AppImage`, nightly, nv),
		"Ryu.Desktop.Nightly.0.1.8-nightly.20260809.42_amd64.AppImage"
	);
	assert.equal(
		rename(`${nightly}-aarch64.app.tar.gz`, nightly, nv),
		"Ryu.Desktop.Nightly.0.1.8-nightly.20260809.42-aarch64.app.tar.gz"
	);
});

test("foreign and already-renamed files are left alone", () => {
	assert.equal(rename("ryu-island-mac-arm64.dmg", STABLE, V), null);
	assert.equal(rename("Ryu.Desktop.Research_Preview.0.1.7_aarch64.dmg", STABLE, V), null);
});

test("the guard rejects a set that breaks a matcher", () => {
	// A rename that dropped the arch suffix from the updater bundle — the exact
	// v0.1.5 macOS-no-update shape.
	assert.throws(
		() => assertSuffixContract(["Ryu.Desktop.Research_Preview.0.1.7.app.tar.gz"]),
		/updater bundle/
	);
	// A name GitHub would rewrite.
	assert.throws(() => assertSuffixContract(["Ryu (Research Preview)_0.1.7_x64.dmg"]), /space or paren/);
	// A signature whose parent is not present.
	assert.throws(
		() => assertSuffixContract(["Ryu.Desktop.Research_Preview.0.1.7_amd64.AppImage.sig"]),
		/orphan signature/
	);
});

test("the full stable set passes the guard", () => {
	assert.doesNotThrow(() => assertSuffixContract(stableSet()));
});
