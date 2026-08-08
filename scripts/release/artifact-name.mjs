#!/usr/bin/env node
// scripts/release/artifact-name.mjs
//
// GIVE THE DESKTOP BUNDLES A READABLE, SELF-DESCRIBING FILE NAME.
//
// Tauri names every bundle from `productName`, and channel-brand.mjs stamps the
// channel into that on purpose — the OS-registered name should say what channel
// you are running. But `productName` is "Ryu (Research Preview)" on stable, so
// the artifact lands as `Ryu (Research Preview)_0.1.7_aarch64.dmg`, and GitHub
// rewrites every space and paren to a dot when it stores the asset:
//
//     Ryu.Research.Preview._0.1.7_aarch64.dmg
//
// Which reads like the `research` APP leaked into the hub release, and is what a
// human scanning the release page fails to recognise as "the Mac installer" at
// all. This step decouples the two: the OS name stays branded, the FILE name
// becomes explicit about product, surface, channel and version.
//
//     Ryu.Desktop.Research_Preview.0.1.7_aarch64.dmg
//
//   node scripts/release/artifact-name.mjs --dir dist-desktop
//   node scripts/release/artifact-name.mjs --dir dist-desktop --dry-run
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SUFFIX CONTRACT — the whole reason this is a rename and not a `productName`
// change.
//
// Four independent consumers resolve these artifacts by matching the END of the
// filename. Every one of them fails SILENTLY — a miss is omitted, not fatal —
// which is exactly how v0.1.5 published a `latest.json` carrying only linux and
// windows while the `updater-feed` job stayed green and every macOS user was
// offered no update at all.
//
//   scripts/release/assemble-channel-feed.sh   -aarch64.app.tar.gz$   (darwin-aarch64)
//                                              -x86_64.app.tar.gz$    (darwin-x86_64)
//                                              _amd64.AppImage$       (linux-x86_64)
//                                              _x64-setup.exe$        (windows-x86_64)
//   packages/blocks/src/web/download-assets.ts  _aarch64.dmg$ _x64.dmg$
//                                               x64-setup.exe$ x64_en-US.msi$
//                                               amd64.AppImage$ amd64.deb$ x86_64.rpm$
//
// So the rewrite only ever replaces the PREFIX (everything up to the version) and
// never touches the tail. `assertSuffixContract` re-checks that on every run and
// throws rather than let a broken set reach `gh release upload`.
//
// A second, equally silent contract: assemble-channel-feed.sh:127 looks up the
// signature with an EXACT `grep -qxF "$artifact.sig"`. So a `.sig` must land on
// precisely its parent's new name plus `.sig` — which it does here for free,
// because `<parent>.sig` shares the parent's prefix and its tail simply ends
// `.sig`.
//
// And a third: `packages/blocks`' NON_DESKTOP_ASSET_RE is
// /^ryu-(island|browser|cli|core|gateway)[-_]/i, which excludes the companion
// apps from the marketing site's download resolver. `Ryu.Desktop.…` has a DOT
// after "Ryu", not a hyphen, so it is correctly still treated as a desktop asset.
// Do not switch the separator to a hyphen.

import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const CONFIG = join(REPO, "apps/desktop/src-tauri/tauri.conf.json");

const APP_NAME = "Ryu";
const SURFACE = "Desktop";

const log = (msg) => process.stdout.write(`artifact-name: ${msg}\n`);

/**
 * The filename prefix that replaces `productName`.
 *
 * `productName` is "Ryu" on an unbranded build and "Ryu (<Label>)" once
 * channel-brand.mjs has run. The label becomes an underscored token so the
 * result carries no character GitHub would rewrite:
 *
 *   "Ryu (Research Preview)" -> "Ryu.Desktop.Research_Preview"
 *   "Ryu (Nightly)"          -> "Ryu.Desktop.Nightly"
 *   "Ryu"                    -> "Ryu.Desktop"
 */
export function slugFor(productName) {
	const label = /\(([^)]*)\)/.exec(String(productName ?? ""))?.[1]?.trim();
	const base = `${APP_NAME}.${SURFACE}`;
	if (!label) {
		return base;
	}
	return `${base}.${label.replace(/\s+/g, "_")}`;
}

/**
 * Rewrite one artifact's name, preserving everything from the version onward.
 *
 * Tauri emits three shapes, and the third is the one that needs care:
 *
 *   <productName>_<version>_<arch>.<ext>      dmg / msi / AppImage / deb
 *   <productName>-<version>-1.<arch>.rpm      rpm
 *   <productName>-<arch>.app.tar.gz           updater bundle — NO version in it
 *
 * The updater bundle carries no version of its own (the workflow only stamps the
 * arch in, to stop the two macOS legs clobbering each other), so the version is
 * INSERTED there rather than kept. That is what lets the release page show a
 * version on every artifact while `-<arch>.app.tar.gz` — the suffix the updater
 * feed matches on — survives untouched.
 *
 * Returns null when the name does not start with `productName`, which is how
 * already-renamed files and foreign files (the Island installers are collected
 * separately, but be defensive) are left alone.
 */
export function rename(base, productName, version) {
	if (!base.startsWith(productName)) {
		return null;
	}
	const tail = base.slice(productName.length);
	const slug = slugFor(productName);
	// `_0.1.7_…` / `-0.1.7-1.…`: the version is already there, drop the leading
	// separator so it reads `<slug>.<version>…`.
	for (const sep of ["_", "-"]) {
		if (tail.startsWith(`${sep}${version}`)) {
			return `${slug}.${tail.slice(sep.length)}`;
		}
	}
	// `-aarch64.app.tar.gz`: no version present, so insert one before the tail.
	return `${slug}.${version}${tail}`;
}

/**
 * Refuse to hand `gh release upload` a set that would break a downstream matcher.
 *
 * Checked by REGEX against the produced names rather than by eyeballing a list,
 * because the failure this guards is invisible at the release: a feed that omits
 * a platform publishes green.
 */
export function assertSuffixContract(names) {
	const problems = [];
	const dirty = names.filter((n) => /[ ()]/.test(n));
	if (dirty.length > 0) {
		problems.push(
			`names still contain a space or paren (GitHub will rewrite them): ${dirty.join(", ")}`
		);
	}
	// Only assert a platform's suffix when that platform is present: a single
	// matrix leg uploads only its own OS's artifacts, so demanding all four here
	// would fail every leg. The macOS leg must carry at least one arch bundle.
	const required = [
		[/\.app\.tar\.gz$/, /-(?:aarch64|x86_64)\.app\.tar\.gz$/, "updater bundle"],
		[/\.AppImage$/, /_amd64\.AppImage$/, "linux AppImage"],
		[/-setup\.exe$/, /_x64-setup\.exe$/, "windows setup"],
		[/\.dmg$/, /_(?:aarch64|x64)\.dmg$/, "macOS dmg"],
		[/\.msi$/, /_x64_en-US\.msi$/, "windows msi"],
		[/\.rpm$/, /x86_64\.rpm$/, "linux rpm"],
	];
	for (const [present, contract, what] of required) {
		const has = names.filter((n) => present.test(n) && !n.endsWith(".sig"));
		if (has.length > 0 && !has.some((n) => contract.test(n))) {
			problems.push(`${what}: ${has.join(", ")} no longer matches ${contract}`);
		}
	}
	// A signature is addressed as EXACTLY `<artifact>.sig`, so an orphan means a
	// platform silently drops out of latest.json.
	for (const sig of names.filter((n) => n.endsWith(".sig"))) {
		const parent = sig.slice(0, -".sig".length);
		if (!names.includes(parent)) {
			problems.push(`orphan signature ${sig}: no artifact named ${parent}`);
		}
	}
	if (problems.length > 0) {
		throw new Error(`artifact-name: suffix contract violated\n  ${problems.join("\n  ")}`);
	}
}

function main() {
	const argv = process.argv.slice(2);
	const at = argv.indexOf("--dir");
	const dir = at === -1 ? "dist-desktop" : argv[at + 1];
	const dryRun = argv.includes("--dry-run");
	if (!existsSync(dir)) {
		log(`no ${dir}/ — nothing to rename`);
		return;
	}
	const config = JSON.parse(readFileSync(CONFIG, "utf8"));
	const productName = config.productName;
	const version = config.version;
	if (!(productName && version)) {
		throw new Error("artifact-name: tauri.conf.json has no productName/version");
	}

	const planned = [];
	for (const base of readdirSync(dir)) {
		const next = rename(base, productName, version);
		if (next && next !== base) {
			planned.push([base, next]);
		}
	}

	const final = readdirSync(dir).map((base) => {
		const hit = planned.find((p) => p[0] === base);
		return hit ? hit[1] : base;
	});
	assertSuffixContract(final);

	for (const [from, to] of planned) {
		log(`${from} -> ${to}`);
		if (!dryRun) {
			renameSync(join(dir, from), join(dir, to));
		}
	}
	log(`${planned.length} renamed in ${dir}/ (productName "${productName}", version ${version})`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	main();
}
