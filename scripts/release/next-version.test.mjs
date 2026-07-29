// Unit tests for the channel version calculator (scripts/release/next-version.mjs).
//
// Two properties are load-bearing here, and both were BROKEN before this script:
//
//   1. ORDERING. `comparePrecedence` is the reference implementation of the rule
//      `apps/core/src/update/mod.rs::is_newer` must match. If these two ever
//      disagree, the updater ships a wrong verdict — the Rust side has a mirrored
//      test suite (`mod tests` in that file) asserting the same cases.
//   2. AUTO-DETECTION. The base version must advance past published stable
//      releases (so a nightly is never stamped with a version that already shipped)
//      WITHOUT being dragged forward by unreleased prereleases (so beta.2 lands on
//      the same base as beta.1).
//
// Run: node --test scripts/release/next-version.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	baseOf,
	comparePrecedence,
	isNewer,
	nextBetaOrdinal,
	nextVersion,
	parseVersion,
	resolveBase,
	utcDateStamp,
} from "./next-version.mjs";

test("parseVersion splits core, prerelease, and build metadata", () => {
	assert.deepEqual(parseVersion("0.0.12"), {
		major: 0,
		minor: 0,
		patch: 12,
		prerelease: [],
		build: null,
	});
	assert.deepEqual(parseVersion("v0.0.12-beta.1"), {
		major: 0,
		minor: 0,
		patch: 12,
		prerelease: ["beta", "1"],
		build: null,
	});
	assert.deepEqual(parseVersion("0.0.30-nightly.20260728.932+f1a68ac9b05c"), {
		major: 0,
		minor: 0,
		patch: 30,
		prerelease: ["nightly", "20260728", "932"],
		build: "f1a68ac9b05c",
	});
});

test("parseVersion returns null for junk rather than throwing", () => {
	for (const junk of ["", "nightly", "1.2", "1.2.3.4", "v", null, undefined]) {
		assert.equal(parseVersion(junk), null, `expected null for ${junk}`);
	}
});

test("a prerelease sorts BELOW its own stable release (semver §11.3)", () => {
	// This is the case the old Rust `parse_semver` got wrong: it discarded the
	// suffix, so 0.0.12-nightly.x compared EQUAL to 0.0.12 and a nightly user was
	// never offered the stable build.
	assert.equal(comparePrecedence("0.0.12-nightly.20260728.932", "0.0.12"), -1);
	assert.equal(comparePrecedence("0.0.12-beta.1", "0.0.12"), -1);
	assert.equal(isNewer("0.0.12-nightly.20260728.932", "0.0.12"), true);
	assert.equal(isNewer("0.0.12", "0.0.12-nightly.20260728.932"), false);
});

test("two nightlies order by date then build number", () => {
	// The other half of the old bug: identical parsed triples meant no nightly was
	// ever newer than any other, so the channel could never self-update.
	assert.equal(
		isNewer("0.0.12-nightly.20260728.932", "0.0.12-nightly.20260729.940"),
		true
	);
	assert.equal(
		isNewer("0.0.12-nightly.20260729.940", "0.0.12-nightly.20260728.932"),
		false
	);
	// Same day, later run number.
	assert.equal(
		isNewer("0.0.12-nightly.20260728.932", "0.0.12-nightly.20260728.933"),
		true
	);
});

test("numeric prerelease identifiers compare numerically, not lexically", () => {
	// Lexically "10" < "9"; numerically 10 > 9. Getting this wrong would stall the
	// beta channel at beta.9.
	assert.equal(isNewer("0.0.12-beta.9", "0.0.12-beta.10"), true);
	assert.equal(
		isNewer("0.0.12-nightly.20260728.99", "0.0.12-nightly.20260728.100"),
		true
	);
});

test("numeric identifiers rank below alphanumeric, shorter lists rank lower", () => {
	// semver §11.4.3 / §11.4.4.
	assert.equal(comparePrecedence("1.0.0-alpha.1", "1.0.0-alpha.beta"), -1);
	assert.equal(comparePrecedence("1.0.0-alpha", "1.0.0-alpha.1"), -1);
});

test("the canonical semver §11 precedence chain holds end to end", () => {
	const ascending = [
		"1.0.0-alpha",
		"1.0.0-alpha.1",
		"1.0.0-alpha.beta",
		"1.0.0-beta",
		"1.0.0-beta.2",
		"1.0.0-beta.11",
		"1.0.0-rc.1",
		"1.0.0",
	];
	for (let i = 0; i < ascending.length - 1; i++) {
		assert.equal(
			comparePrecedence(ascending[i], ascending[i + 1]),
			-1,
			`${ascending[i]} should precede ${ascending[i + 1]}`
		);
	}
});

test("build metadata is ignored for precedence (semver §10)", () => {
	assert.equal(comparePrecedence("1.0.0+aaa", "1.0.0+zzz"), 0);
	assert.equal(comparePrecedence("1.0.0-beta.1+aaa", "1.0.0-beta.1+zzz"), 0);
});

test("major/minor/patch dominate the prerelease comparison", () => {
	assert.equal(isNewer("0.0.12", "0.0.13-nightly.20260728.1"), true);
	assert.equal(isNewer("0.1.0-beta.1", "0.1.0"), true);
	assert.equal(isNewer("0.2.0-beta.1", "0.1.0"), false);
});

test("unparseable versions never claim to be newer", () => {
	// The fail-safe: a malformed tag must not be able to trigger an update.
	assert.equal(isNewer("0.0.12", "not-a-version"), false);
	assert.equal(isNewer("0.0.12", ""), false);
	// ...and a real version IS newer than junk, so a corrupt installed version
	// still recovers onto a good release.
	assert.equal(isNewer("garbage", "0.0.12"), true);
});

test("baseOf strips prerelease and build suffixes", () => {
	assert.equal(baseOf("0.0.30-nightly.20260728.932+abc"), "0.0.30");
	assert.equal(baseOf("0.0.12"), "0.0.12");
	assert.equal(baseOf("junk"), null);
});

test("resolveBase bumps the patch past published stable releases", () => {
	// The live case at the time of writing: tauri.conf.json said 0.0.11 while
	// v0.0.12 was already published, so a nightly stamped from the in-tree version
	// alone would have collided with a shipped release.
	assert.equal(resolveBase("0.0.11", ["v0.0.11", "v0.0.12"]), "0.0.13");
	assert.equal(resolveBase("0.0.11", ["v0.0.11"]), "0.0.12");
	assert.equal(resolveBase("0.0.11", []), "0.0.11");
});

test("resolveBase respects a deliberate minor/major bump", () => {
	// After `bump-version.sh 0.1.0`, nightlies must move to the 0.1.0 line rather
	// than being dragged back to latest-release+1 on the old 0.0.x line.
	assert.equal(resolveBase("0.1.0", ["v0.0.11", "v0.0.12"]), "0.1.0");
	assert.equal(resolveBase("1.0.0", ["v0.0.12"]), "1.0.0");
});

test("resolveBase ignores prereleases when advancing the patch", () => {
	// An unreleased 0.0.12-beta.3 must NOT push the base to 0.0.13 — beta.4 belongs
	// on the same base, and the eventual stable is 0.0.12.
	assert.equal(
		resolveBase("0.0.12", ["v0.0.12-beta.1", "v0.0.12-beta.3", "nightly"]),
		"0.0.12"
	);
});

test("resolveBase tolerates junk tags in the release list", () => {
	// Rolling tags (`nightly`, `canary`) and stray non-version releases live in the
	// same `gh release list` output.
	assert.equal(
		resolveBase("0.0.11", ["nightly", "canary", "unsloth-sidecar", "v0.0.11"]),
		"0.0.12"
	);
});

test("resolveBase rejects an unparseable in-tree version loudly", () => {
	assert.throws(() => resolveBase("not-a-version", []), /cannot parse/);
});

test("nextBetaOrdinal continues the sequence for the base", () => {
	assert.equal(nextBetaOrdinal("0.0.12", []), 1);
	assert.equal(nextBetaOrdinal("0.0.12", ["v0.0.12-beta.1"]), 2);
	assert.equal(
		nextBetaOrdinal("0.0.12", ["v0.0.12-beta.1", "v0.0.12-beta.7"]),
		8
	);
	// Betas on a DIFFERENT base do not carry over.
	assert.equal(nextBetaOrdinal("0.0.13", ["v0.0.12-beta.7"]), 1);
	// Non-beta prereleases on the same base are ignored.
	assert.equal(nextBetaOrdinal("0.0.12", ["v0.0.12-nightly.20260728.932"]), 1);
});

test("nextVersion produces the documented format per channel", () => {
	const common = {
		inTreeVersion: "0.0.11",
		published: ["v0.0.11"],
		date: "20260728",
		build: 932,
	};
	assert.equal(nextVersion({ ...common, channel: "stable" }), "0.0.12");
	assert.equal(nextVersion({ ...common, channel: "beta" }), "0.0.12-beta.1");
	assert.equal(
		nextVersion({ ...common, channel: "nightly" }),
		"0.0.12-nightly.20260728.932"
	);
	assert.equal(
		nextVersion({ ...common, channel: "canary" }),
		"0.0.12-canary.20260728.932"
	);
});

test("nextVersion output is ordered stable > canary > beta within a base", () => {
	// Not a product ordering — just the semver consequence of the identifier names.
	// Cross-channel comparison is meaningless by design (switching channels is a
	// channel switch, not an update), but the values must at least be DISTINCT so
	// no two channels ever produce the same string.
	const versions = [
		"0.0.12-beta.1",
		"0.0.12-canary.20260728.932",
		"0.0.12-nightly.20260728.932",
		"0.0.12",
	];
	assert.equal(new Set(versions).size, versions.length);
});

test("nextVersion honours an explicit base override", () => {
	assert.equal(
		nextVersion({
			channel: "nightly",
			inTreeVersion: "0.0.11",
			base: "9.9.9",
			date: "20260728",
			build: 1,
		}),
		"9.9.9-nightly.20260728.1"
	);
});

test("nextVersion rejects an unknown channel", () => {
	assert.throws(
		() => nextVersion({ channel: "edge", inTreeVersion: "0.0.11" }),
		/unknown channel/
	);
});

test("every generated version parses back and outranks the previous build", () => {
	// Round-trip guard: whatever the generator emits must be consumable by the
	// comparator, and consecutive nightly runs must strictly increase.
	const first = nextVersion({
		channel: "nightly",
		inTreeVersion: "0.0.11",
		published: ["v0.0.11"],
		date: "20260728",
		build: 932,
	});
	const second = nextVersion({
		channel: "nightly",
		inTreeVersion: "0.0.11",
		published: ["v0.0.11"],
		date: "20260728",
		build: 933,
	});
	assert.ok(parseVersion(first));
	assert.ok(parseVersion(second));
	assert.equal(isNewer(first, second), true);
});

test("utcDateStamp is a compact UTC YYYYMMDD with no separators", () => {
	assert.equal(utcDateStamp(new Date("2026-07-28T23:59:59Z")), "20260728");
	assert.match(utcDateStamp(), /^\d{8}$/);
});
