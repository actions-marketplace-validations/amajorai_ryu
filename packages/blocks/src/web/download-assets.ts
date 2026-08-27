/**
 * Release-asset resolution for every download surface.
 *
 * Kept free of JSX and `@ryu/ui` imports on purpose: this is the part with real
 * logic (which file a given machine should get), so it has to be unit-testable
 * without a React or design-system resolver — same shape as `island-snap.ts`.
 * The presentational `download.tsx` re-exports everything here.
 */

export type DownloadOS = "macos" | "windows" | "linux";
export type DownloadArch = "intel" | "arm";

export interface ReleaseAsset {
	browser_download_url: string;
	name: string;
}

export interface Release {
	assets: ReleaseAsset[];
	draft?: boolean;
	html_url: string;
	id: number;
	name: string;
	prerelease?: boolean;
	published_at: string;
	tag_name: string;
}

export const GITHUB_RELEASES_REPO = "amajorai/ryu";
export const RELEASES_PAGE = `https://github.com/${GITHUB_RELEASES_REPO}/releases`;
export const RELEASES_API = `https://api.github.com/repos/${GITHUB_RELEASES_REPO}/releases`;
export const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_RELEASES_REPO}/releases/latest`;
export const GITHUB_REPO = `https://github.com/${GITHUB_RELEASES_REPO}`;

/** Detect the visitor's desktop platform without making module evaluation browser-only. */
export function detectDownloadOS(): DownloadOS {
	if (typeof window === "undefined") {
		return "macos";
	}
	const userAgent = window.navigator.userAgent.toLowerCase();
	const platform = window.navigator.platform.toLowerCase();
	if (
		userAgent.includes("mac") ||
		userAgent.includes("iphone") ||
		userAgent.includes("ipad") ||
		platform.includes("mac")
	) {
		return "macos";
	}
	if (userAgent.includes("win") || platform.includes("win")) {
		return "windows";
	}
	if (
		userAgent.includes("linux") ||
		platform.includes("linux") ||
		userAgent.includes("x11")
	) {
		return "linux";
	}
	return "macos";
}

/** Resolve architecture signals, preferring the browser's explicit CPU value. */
export function classifyDownloadArch(
	userAgent: string,
	highEntropyArchitecture?: string | null
): DownloadArch {
	const architecture = highEntropyArchitecture?.toLowerCase() ?? "";
	const normalizedUserAgent = userAgent.toLowerCase();
	return architecture.includes("arm") ||
		normalizedUserAgent.includes("arm") ||
		normalizedUserAgent.includes("aarch64")
		? "arm"
		: "intel";
}

/** Detect the visitor's processor architecture, defaulting to Intel-compatible builds. */
export function detectDownloadArch(): DownloadArch {
	if (typeof window === "undefined") {
		return "intel";
	}
	return classifyDownloadArch(window.navigator.userAgent);
}

/**
 * Chromium deliberately reports Apple-silicon Macs as `MacIntel` in its normal
 * user agent. Use its high-entropy architecture signal when available, while
 * retaining the synchronous detector as the Safari/Firefox fallback.
 */
export async function detectDownloadArchAsync(): Promise<DownloadArch> {
	if (typeof window === "undefined") {
		return "intel";
	}
	const browserNavigator = window.navigator as Navigator & {
		userAgentData?: {
			getHighEntropyValues?: (
				hints: string[]
			) => Promise<{ architecture?: string }>;
		};
	};
	try {
		const values = await browserNavigator.userAgentData?.getHighEntropyValues?.(
			["architecture"]
		);
		return classifyDownloadArch(
			browserNavigator.userAgent,
			values?.architecture
		);
	} catch {
		return detectDownloadArch();
	}
}

/**
 * Filenames of the desktop installer, per platform and architecture.
 *
 * Windows ARM and Linux ARM have entries but no build ships under them today;
 * the resolver returns null for those and the UI says "Not available" rather
 * than offering a link to a page with nothing on it.
 */
export const PLATFORM_ASSET_PATTERNS: Record<
	DownloadOS,
	Record<DownloadArch, RegExp[]>
> = {
	macos: {
		arm: [/aarch64\.dmg$/i, /_aarch64\.dmg$/i],
		intel: [/x64\.dmg$/i, /_x64\.dmg$/i],
	},
	windows: {
		arm: [/arm64.*setup\.exe$/i],
		intel: [/x64-setup\.exe$/i, /x64_en-US\.msi$/i],
	},
	linux: {
		arm: [/aarch64\.AppImage$/i, /arm64\.AppImage$/i, /arm64\.deb$/i],
		intel: [/amd64\.AppImage$/i, /amd64\.deb$/i, /x86_64\.rpm$/i],
	},
};

/**
 * Filenames for the standalone headless Core binary. These are deliberately
 * separate from the desktop installer matcher: the same GitHub release carries
 * both products, and a browser download must never hand someone the desktop
 * app when they asked for the local runtime only.
 */
export const CORE_ASSET_PATTERNS: Record<
	DownloadOS,
	Record<DownloadArch, RegExp[]>
> = {
	macos: {
		arm: [/^ryu-core-macos-aarch64(?:\.exe)?$/i],
		intel: [/^ryu-core-macos-x86_64(?:\.exe)?$/i],
	},
	windows: {
		arm: [/^ryu-core-windows-aarch64\.exe$/i],
		intel: [/^ryu-core-windows-x86_64\.exe$/i],
	},
	linux: {
		arm: [/^ryu-core-linux-aarch64$/i],
		intel: [/^ryu-core-linux-x86_64$/i],
	},
};

export function findCoreReleaseAsset(
	release: Release,
	platformId: string,
	arch: DownloadArch
): ReleaseAsset | null {
	if (!release.assets?.length) {
		return null;
	}
	const patterns =
		CORE_ASSET_PATTERNS[platformId as DownloadOS]?.[arch] ?? null;
	if (!patterns) {
		return null;
	}
	for (const pattern of patterns) {
		const asset = release.assets.find((candidate) =>
			pattern.test(candidate.name)
		);
		if (asset) {
			return asset;
		}
	}
	return null;
}

/** Newest non-draft release that actually carries a Core binary. */
export function findCoreReleaseWithAsset(
	releases: Release[],
	platformId: string,
	arch: DownloadArch
): { release: Release; asset: ReleaseAsset } | null {
	for (const release of releases) {
		if (release.draft) {
			continue;
		}
		const asset = findCoreReleaseAsset(release, platformId, arch);
		if (asset) {
			return { release, asset };
		}
	}
	return null;
}

/**
 * Assets in the release that are NOT the desktop app.
 *
 * A single GitHub release carries the desktop installers alongside the
 * companion apps and the raw sidecar binaries, and their names collide with the
 * patterns above: `ryu-island-win-x64-setup.exe` matches `/x64-setup\.exe$/i`
 * and sorts *before* `Ryu_0.1.1_x64-setup.exe`, so the Windows download on the
 * marketing site handed people the Island installer.
 *
 * This is not a Windows special-case — Linux x64's `/amd64\.deb$/i` matches
 * `ryu-island-linux-amd64.deb` too, and only escapes the same fate because the
 * AppImage pattern happens to be tried first. `ryu-browser-<os>-<arch>` assets
 * are already planned in `.github/workflows/release.yml`, so exclude the whole
 * component family by name rather than tightening one pattern at a time.
 */
const NON_DESKTOP_ASSET_RE = /^ryu-(island|browser|cli|core|gateway)[-_]/i;

export function isDesktopAsset(name: string): boolean {
	return !NON_DESKTOP_ASSET_RE.test(name);
}

export function findReleaseAsset(
	release: Release,
	platformId: string,
	arch: DownloadArch
): ReleaseAsset | null {
	if (!release.assets?.length) {
		return null;
	}
	const patterns =
		PLATFORM_ASSET_PATTERNS[platformId as DownloadOS]?.[arch] ?? null;
	if (!patterns) {
		return null;
	}
	const desktopAssets = release.assets.filter((a) => isDesktopAsset(a.name));
	for (const pattern of patterns) {
		const asset = desktopAssets.find((a) => pattern.test(a.name));
		if (asset) {
			return asset;
		}
	}
	return null;
}

/**
 * Newest release that actually CARRIES the asset for this platform/arch.
 *
 * A GitHub release exists the moment it is tagged, but its binaries are uploaded
 * by a build that can take many minutes — so "latest release" is routinely a
 * release with no desktop assets yet, and linking to it hands the user a dead
 * download. Walk newest-to-oldest and return the first release that really has
 * the file, so a still-building version transparently falls back to the last
 * good one. Returns null only when no release in the list has it.
 */
export function findReleaseWithAsset(
	releases: Release[],
	platformId: string,
	arch: DownloadArch
): { release: Release; asset: ReleaseAsset } | null {
	for (const release of releases) {
		if (release.draft) {
			continue;
		}
		const asset = findReleaseAsset(release, platformId, arch);
		if (asset) {
			return { release, asset };
		}
	}
	return null;
}

/**
 * What a download row can actually offer right now.
 *
 * The four cases are genuinely different and must not be collapsed — conflating
 * "we don't ship this" with "we haven't loaded the release list" is what turns a
 * transient GitHub blip into a download page with nothing on it:
 *
 * - `ready`     an installer to link at. `servedVersion` is the tag it really
 *               comes from, which during a release window is NOT the newest tag.
 * - `building`  the newest release is tagged but this build hasn't been uploaded
 *               yet, and no older release has it either. Nothing to link at, but
 *               it is coming — say so instead of "not available".
 * - `unavailable` searched every release we hold and none ships this target.
 * - `unknown`   we could not read the release list at all. Never disable on
 *               this: link out to the releases page so the visitor can still
 *               get the app by hand.
 */
export type DownloadState =
	| {
			kind: "ready";
			asset: ReleaseAsset;
			servedVersion: string;
			/** True when a newer release exists whose build hasn't landed yet. */
			supersededByBuilding: boolean;
	  }
	| { kind: "building"; version: string }
	| { kind: "unavailable" }
	| { kind: "unknown"; href: string };

/** Newest non-draft release, i.e. the one a visitor would expect to get. */
export function newestRelease(releases: Release[]): Release | null {
	return releases.find((release) => !release.draft) ?? null;
}

/**
 * Resolve one platform+arch against a list of releases, newest first.
 *
 * Pass the full stable list for a "give me the current app" surface (so a
 * still-building release transparently falls back to the last good one), or a
 * single-element list to ask about one specific release.
 */
export function resolveDownloadState(
	releases: Release[],
	platformId: string,
	arch: DownloadArch
): DownloadState {
	const newest = newestRelease(releases);
	if (!newest) {
		return { kind: "unknown", href: RELEASES_PAGE };
	}
	const found = findReleaseWithAsset(releases, platformId, arch);
	if (found) {
		return {
			kind: "ready",
			asset: found.asset,
			servedVersion: found.release.tag_name,
			supersededByBuilding: found.release.id !== newest.id,
		};
	}
	// Nothing anywhere carries this target. Only call that "building" when NO
	// release we hold has shipped any desktop asset — then the builds genuinely
	// have not landed yet and every platform is equally missing.
	//
	// Gating on the newest release alone would be wrong: Windows ARM and Linux
	// ARM are absent from every release forever, so during each release window
	// they would flip from an honest "Not available" to "still building" for a
	// binary that is never coming.
	const anyDesktopAssetEverShipped = releases.some((release) =>
		release.assets.some((asset) => isDesktopAsset(asset.name))
	);
	if (anyDesktopAssetEverShipped) {
		return { kind: "unavailable" };
	}
	return { kind: "building", version: newest.tag_name };
}

export function getAssetUrl(
	release: Release,
	platformId: string,
	arch: DownloadArch
) {
	const asset = findReleaseAsset(release, platformId, arch);
	if (asset) {
		return asset.browser_download_url;
	}
	// Fallback: link to the release's assets section instead of generic releases page
	return `${release.html_url}#assets`;
}

/**
 * A release fit to be offered as *the* download.
 *
 * `nightly` and `canary` are rolling prerelease tags that are re-cut constantly,
 * so either can be the newest entry the API returns. Left in the main list, the
 * menu labels the download "nightly" and the download page lists rolling tags
 * under "Previous releases". They are still fetched — the Developers section
 * offers them deliberately — just never treated as the stable release.
 */
export function isStableRelease(release: Release): boolean {
	return !(release.draft || release.prerelease);
}

/** Only the stable releases, newest first. */
export function stableReleases(releases: Release[]): Release[] {
	return releases.filter(isStableRelease);
}

/** The rolling prerelease channels, offered under Developers. */
export const PRERELEASE_CHANNELS = [
	{ id: "nightly", label: "Nightly" },
	{ id: "canary", label: "Canary" },
] as const;

export type PrereleaseChannel = (typeof PRERELEASE_CHANNELS)[number]["id"];

/**
 * The rolling release carrying a channel's builds.
 *
 * Matched on tag rather than on "newest prerelease" because both channels are
 * live at once and each keeps its own fixed tag (`nightly`, `canary`) that the
 * release workflow force-pushes.
 */
export function findChannelRelease(
	releases: Release[],
	channel: PrereleaseChannel
): Release | null {
	return (
		releases.find(
			(release) => !release.draft && release.tag_name === channel
		) ?? null
	);
}

/**
 * Fetch releases from GitHub API with retry logic.
 * Handles rate limiting and network errors with exponential backoff.
 *
 * Returns every non-draft release, prereleases included — the caller decides
 * which list it wants (`stableReleases` for the download rows,
 * `findChannelRelease` for the nightly/canary channels).
 *
 * Prefer `loadReleases()` from UI code — it shares one request across every
 * download menu on the page.
 */
export async function fetchReleasesWithRetry(
	maxRetries = 3,
	baseDelay = 1000
): Promise<Release[]> {
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			const response = await fetch(RELEASES_API);
			if (response.ok) {
				const data = await response.json();
				if (Array.isArray(data)) {
					return data.filter((release: Release) => !release.draft);
				}
				return [];
			}
			// If rate limited, wait and retry
			if (response.status === 403 || response.status === 429) {
				const delay = baseDelay * 2 ** attempt;
				await new Promise((resolve) => setTimeout(resolve, delay));
				continue;
			}
			// Other errors, don't retry
			return [];
		} catch {
			// Network error, retry with backoff
			if (attempt < maxRetries - 1) {
				const delay = baseDelay * 2 ** attempt;
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
	}
	return [];
}

let releasesPromise: Promise<Release[]> | null = null;

/**
 * Shared releases fetch for every download surface on the page.
 *
 * A marketing page mounts `DownloadMenu` several times (hero, CTA band,
 * sections, story) and each one used to fire its own request on mount — whether
 * or not the menu was ever opened. Unauthenticated GitHub allows 60 requests an
 * hour per IP; past that every row silently degrades to the releases page,
 * which looks exactly like the menu being broken. One in-flight promise, cached
 * for the life of the document, keeps a page view at a single request.
 */
export function loadReleases(): Promise<Release[]> {
	if (!releasesPromise) {
		releasesPromise = fetchReleasesWithRetry().catch(() => []);
	}
	return releasesPromise;
}

/** Test seam: drop the cached fetch so the next `loadReleases()` refetches. */
export function resetReleasesCache() {
	releasesPromise = null;
}

export function archLabel(platformId: string, arch: DownloadArch) {
	if (platformId === "macos") {
		return arch === "arm" ? "Apple Silicon" : "Intel";
	}
	return arch === "arm" ? "ARM64" : "x64";
}

export function osName(os: DownloadOS) {
	if (os === "windows") {
		return "Windows";
	}
	if (os === "linux") {
		return "Linux";
	}
	return "macOS";
}
