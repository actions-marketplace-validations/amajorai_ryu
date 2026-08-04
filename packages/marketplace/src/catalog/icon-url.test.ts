// Unit tests for the catalog icon resolver. The security-relevant behavior is the
// GitHub-image allowlist: a URL pasted into the Icon-primitive `icon` field is only
// promoted to a raster slot when it is a GitHub image host, otherwise dropped so a
// stray tracker URL never reaches the Icon primitive or gets fetched.

import { describe, expect, test } from "bun:test";
import { isGithubImageUrl, isHttpUrl, resolveCardIcon } from "./icon-url.ts";

describe("isGithubImageUrl", () => {
	test("accepts *.githubusercontent.com over https", () => {
		expect(
			isGithubImageUrl("https://raw.githubusercontent.com/a/b/logo.png")
		).toBe(true);
		expect(
			isGithubImageUrl(
				"https://private-user-images.githubusercontent.com/x.png"
			)
		).toBe(true);
	});

	test("accepts the bare githubusercontent.com apex", () => {
		expect(isGithubImageUrl("https://githubusercontent.com/x.png")).toBe(true);
	});

	test("accepts github.com only on /assets/ or /raw/ paths", () => {
		expect(isGithubImageUrl("https://github.com/o/r/raw/main/logo.png")).toBe(
			true
		);
		expect(isGithubImageUrl("https://github.com/o/r/assets/12345")).toBe(true);
		expect(isGithubImageUrl("https://github.com/o/r/blob/main/logo.png")).toBe(
			false
		);
	});

	test("rejects non-https schemes", () => {
		expect(isGithubImageUrl("http://raw.githubusercontent.com/x.png")).toBe(
			false
		);
	});

	test("rejects a look-alike host that only ends in the brand string", () => {
		expect(
			isGithubImageUrl("https://evilgithubusercontent.com.attacker.io/x")
		).toBe(false);
		expect(isGithubImageUrl("https://notgithub.com/o/r/raw/x.png")).toBe(false);
	});

	test("rejects unrelated hosts and non-URLs", () => {
		expect(isGithubImageUrl("https://evil.com/logo.png")).toBe(false);
		expect(isGithubImageUrl("not a url")).toBe(false);
		expect(isGithubImageUrl(null)).toBe(false);
		expect(isGithubImageUrl(undefined)).toBe(false);
		expect(isGithubImageUrl("")).toBe(false);
	});
});

describe("isHttpUrl", () => {
	test("true for http and https", () => {
		expect(isHttpUrl("http://x")).toBe(true);
		expect(isHttpUrl("https://x")).toBe(true);
		expect(isHttpUrl("HTTPS://X")).toBe(true);
	});

	test("false for icon ids and other schemes", () => {
		expect(isHttpUrl("lucide:brain")).toBe(false);
		expect(isHttpUrl("ftp://x")).toBe(false);
		expect(isHttpUrl(null)).toBe(false);
		expect(isHttpUrl("")).toBe(false);
	});
});

describe("resolveCardIcon", () => {
	test("plain icon id stays an iconId, no raster", () => {
		expect(resolveCardIcon({ icon: "lucide:brain" })).toEqual({
			iconId: "lucide:brain",
			iconUrl: null,
			iconUrlDark: null,
			brand: false,
		});
	});

	test("a GitHub-image URL in the icon field is promoted to the raster slot", () => {
		const url = "https://raw.githubusercontent.com/a/b/logo.png";
		expect(resolveCardIcon({ icon: url })).toEqual({
			iconId: null,
			iconUrl: url,
			iconUrlDark: null,
			brand: false,
		});
	});

	test("a non-GitHub URL in the icon field is dropped entirely", () => {
		expect(resolveCardIcon({ icon: "https://evil.com/track.png" })).toEqual({
			iconId: null,
			iconUrl: null,
			iconUrlDark: null,
			brand: false,
		});
	});

	test("the dedicated icon_url raster slot passes through any https host", () => {
		const url = "https://cdn.example.com/logo.png";
		expect(resolveCardIcon({ iconUrl: url })).toEqual({
			iconId: null,
			iconUrl: url,
			iconUrlDark: null,
			brand: false,
		});
	});

	test("icon_url wins as raster while a real icon id is kept", () => {
		expect(
			resolveCardIcon({ icon: "lucide:brain", iconUrl: "https://x/logo.png" })
		).toEqual({
			iconId: "lucide:brain",
			iconUrl: "https://x/logo.png",
			iconUrlDark: null,
			brand: false,
		});
	});

	test("empty inputs resolve to nulls", () => {
		expect(resolveCardIcon({})).toEqual({
			iconId: null,
			iconUrl: null,
			iconUrlDark: null,
			brand: false,
		});
	});

	test("an svgl id resolves to the brand raster, never to an Icon glyph id", () => {
		expect(resolveCardIcon({ icon: "svgl:brave" })).toEqual({
			iconId: null,
			iconUrl: "https://svgl.app/library/brave.svg",
			iconUrlDark: null,
			brand: true,
		});
	});

	test("an svgl id can spell out its own light|dark pair", () => {
		expect(resolveCardIcon({ icon: "svgl:firecrawl|firecrawl-dark" })).toEqual({
			iconId: null,
			iconUrl: "https://svgl.app/library/firecrawl.svg",
			iconUrlDark: "https://svgl.app/library/firecrawl-dark.svg",
			brand: true,
		});
	});

	test("the loaded svgl index supplies a dark variant the id omitted", () => {
		const index = new Map([
			[
				"ollama_light",
				{
					light: "https://svgl.app/library/ollama_light.svg",
					dark: "https://svgl.app/library/ollama_dark.svg",
				},
			],
		]);
		expect(
			resolveCardIcon({ icon: "svgl:ollama_light", svglIndex: index })
		).toEqual({
			iconId: null,
			iconUrl: "https://svgl.app/library/ollama_light.svg",
			iconUrlDark: "https://svgl.app/library/ollama_dark.svg",
			brand: true,
		});
	});

	test("a publisher's own icon_url still beats an svgl id", () => {
		expect(
			resolveCardIcon({ icon: "svgl:brave", iconUrl: "https://x/logo.png" })
		).toEqual({
			iconId: null,
			iconUrl: "https://x/logo.png",
			iconUrlDark: null,
			brand: false,
		});
	});

	test("a malformed svgl slug never reaches the CDN as a path", () => {
		for (const bad of [
			"svgl:../../etc/passwd",
			"svgl:https://evil.com/x.svg",
			"svgl:",
		]) {
			expect(resolveCardIcon({ icon: bad })).toEqual({
				iconId: null,
				iconUrl: null,
				iconUrlDark: null,
				brand: false,
			});
		}
	});
});
