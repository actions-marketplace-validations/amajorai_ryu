import {
	type DownloadArch,
	type DownloadOS,
	detectDownloadArchAsync,
	detectDownloadOS,
	findCoreReleaseWithAsset,
	loadReleases,
	stableReleases,
} from "@ryu/blocks/web/download-assets.ts";

export interface BrowserCoreDownload {
	assetUrl: string;
	fileName: string;
	releaseTag: string;
}

/** Resolve the newest published standalone Core binary for this browser. */
export async function loadBrowserCoreDownload(): Promise<BrowserCoreDownload> {
	const releases = stableReleases(await loadReleases());
	const found = findCoreReleaseWithAsset(
		releases,
		detectDownloadOS(),
		await detectDownloadArchAsync()
	);
	if (!found) {
		throw new Error("Ryu Core is not available for this computer yet.");
	}
	return {
		assetUrl: found.asset.browser_download_url,
		fileName: found.asset.name,
		releaseTag: found.release.tag_name,
	};
}

/** Pure resolver used by focused tests and any preloaded release surface. */
export function resolveBrowserCoreDownload(
	releases: Parameters<typeof stableReleases>[0],
	os: DownloadOS,
	arch: DownloadArch
): BrowserCoreDownload | null {
	const found = findCoreReleaseWithAsset(stableReleases(releases), os, arch);
	if (!found) {
		return null;
	}
	return {
		assetUrl: found.asset.browser_download_url,
		fileName: found.asset.name,
		releaseTag: found.release.tag_name,
	};
}

/**
 * Start the browser download without navigating the web app away. Browsers do
 * not let a page execute an OS binary, so the setup dialog stays open and waits
 * for the user to run Core locally.
 */
export function startBrowserCoreDownload(download: BrowserCoreDownload): void {
	const link = document.createElement("a");
	link.download = download.fileName;
	link.href = download.assetUrl;
	link.rel = "noopener noreferrer";
	link.style.display = "none";
	document.body.append(link);
	link.click();
	link.remove();
}
