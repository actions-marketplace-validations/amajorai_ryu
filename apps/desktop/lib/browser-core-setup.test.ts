import { describe, expect, test } from "bun:test";
import type { Release } from "@ryu/blocks/web/download-assets.ts";
import { resolveBrowserCoreDownload } from "./browser-core-setup.ts";

function release(
	tag: string,
	assets: string[],
	overrides: Partial<Release> = {}
): Release {
	return {
		assets: assets.map((name) => ({
			browser_download_url: `https://example.com/${name}`,
			name,
		})),
		html_url: `https://example.com/releases/${tag}`,
		id: tag.length,
		name: tag,
		published_at: "2026-08-23T00:00:00Z",
		tag_name: tag,
		...overrides,
	};
}

describe("resolveBrowserCoreDownload", () => {
	test("selects the standalone Core binary without confusing it for desktop", () => {
		const result = resolveBrowserCoreDownload(
			[release("v0.2.0", ["Ryu_0.2.0_aarch64.dmg", "ryu-core-macos-aarch64"])],
			"macos",
			"arm"
		);

		expect(result).toEqual({
			assetUrl: "https://example.com/ryu-core-macos-aarch64",
			fileName: "ryu-core-macos-aarch64",
			releaseTag: "v0.2.0",
		});
	});

	test("ignores draft releases and returns null when no stable Core exists", () => {
		const result = resolveBrowserCoreDownload(
			[
				release("v0.3.0", ["ryu-core-windows-x86_64.exe"], {
					draft: true,
				}),
			],
			"windows",
			"intel"
		);

		expect(result).toBeNull();
	});
});
