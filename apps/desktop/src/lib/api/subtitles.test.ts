// Unit tests for `resolveSubtitlesPath` — the desktop half of the
// `subtitles.request` security boundary.
//
// The Subtitles companion is a sandboxed frame holding one capability
// (`subtitles:crud`) and one generic verb. It supplies a sub-path; this function
// decides whether that sub-path is a path under `/api/subtitles`, and
// `client.ts:apiUrl` concatenates the result onto the node base before `fetch` sees
// it WITH the node bearer attached. So a hole here is not a bug in Subtitles — it is
// every API on the node.
//
// The encoded-traversal cases are not hypothetical: the old Outpost check shipped
// as a literal-`..` blocklist and let `/%2e%2e/settings` through as `/api/settings`,
// because `fetch` reads the URL parser's output rather than the string. The shared
// host resolver and its cross-mount corpus now keep that lesson canonical.

import { describe, expect, it } from "bun:test";

import { resolveSubtitlesPath } from "./subtitles.ts";

describe("resolveSubtitlesPath", () => {
	it("prefixes an ordinary sub-path and keeps its query string", () => {
		expect(resolveSubtitlesPath("/jobs")).toBe("/api/subtitles/jobs");
		expect(resolveSubtitlesPath("/jobs/sub_1/download?format=vtt")).toBe(
			"/api/subtitles/jobs/sub_1/download?format=vtt"
		);
		// The library browser passes an absolute filesystem path as a QUERY value —
		// percent-encoded, and it must survive intact or the picker browses nothing.
		expect(resolveSubtitlesPath("/library?dir=%2FUsers%2Fx%2FMovies")).toBe(
			"/api/subtitles/library?dir=%2FUsers%2Fx%2FMovies"
		);
	});

	it("rejects anything that is not a rooted sub-path", () => {
		expect(resolveSubtitlesPath("https://evil.example/x")).toBeNull();
		// Protocol-relative: a URL parser reads this as a different HOST even though
		// it passes a naive "starts with /" check.
		expect(resolveSubtitlesPath("//evil.example/x")).toBeNull();
		expect(resolveSubtitlesPath("jobs")).toBeNull();
		expect(resolveSubtitlesPath("")).toBeNull();
		expect(resolveSubtitlesPath(42)).toBeNull();
		expect(resolveSubtitlesPath(null)).toBeNull();
		expect(resolveSubtitlesPath(undefined)).toBeNull();
	});

	it("rejects a backslash, which some URL parsers treat as a separator", () => {
		expect(resolveSubtitlesPath("/\\..\\settings")).toBeNull();
		expect(resolveSubtitlesPath("/jobs\\..\\..\\plugins")).toBeNull();
	});

	it("rejects a climb out of the mount, literal and percent-encoded", () => {
		for (const path of [
			"/../plugins",
			"/jobs/../../settings",
			"/%2e%2e/settings",
			"/%2E%2E/settings",
			"/.%2e/settings",
			"/%2e./settings",
			"/jobs/%2e%2e/%2e%2e/conversations",
		]) {
			expect(resolveSubtitlesPath(path)).toBeNull();
		}
	});

	it("does not accept a sibling mount that merely shares the prefix", () => {
		// `/api/subtitlesomething` starts with the mount as a STRING but is a
		// different API; the `/`-suffixed containment test is what catches it.
		expect(resolveSubtitlesPath("/../subtitlesomething/x")).toBeNull();
	});

	it("returns the NORMALIZED path, so fetch and the check cannot disagree", () => {
		expect(resolveSubtitlesPath("/jobs/%2e%2e/settings")).toBe(
			"/api/subtitles/settings"
		);
		expect(resolveSubtitlesPath("/jobs/./sub_1")).toBe(
			"/api/subtitles/jobs/sub_1"
		);
	});
});
