import { describe, expect, it } from "bun:test";
import {
	choosePreparedUpdateAction,
	resolveAppUpdateSource,
} from "./app-update-policy.ts";

describe("prepared app update policy", () => {
	it("downloads in advance by default but never chooses installation", () => {
		expect(
			choosePreparedUpdateAction({
				automaticDownload: true,
				latest: "0.2.1",
				preparedVersion: null,
			})
		).toEqual({ kind: "prepare" });
		expect(
			choosePreparedUpdateAction({
				automaticDownload: true,
				latest: "0.2.1",
				preparedVersion: "0.2.1",
			})
		).toEqual({ kind: "prompt_install" });
	});

	it("asks before downloading when automatic downloading is disabled", () => {
		expect(
			choosePreparedUpdateAction({
				automaticDownload: false,
				latest: "0.2.1",
				preparedVersion: null,
			})
		).toEqual({ kind: "notify_download" });
	});

	it("replaces or clears a prepared artifact superseded by a newer verdict", () => {
		expect(
			choosePreparedUpdateAction({
				automaticDownload: true,
				latest: "0.2.2",
				preparedVersion: "0.2.1",
			})
		).toEqual({ kind: "replace" });
		expect(
			choosePreparedUpdateAction({
				automaticDownload: false,
				latest: "0.2.2",
				preparedVersion: "0.2.1",
			})
		).toEqual({ kind: "clear_and_notify" });
	});
});

describe("Tauri updater source policy", () => {
	it("uses only app-owned Stable and release-channel feeds", () => {
		expect(
			resolveAppUpdateSource({
				channel: "stable",
				pin: { kind: "none" },
			})
		).toEqual({ kind: "stable" });
		expect(
			resolveAppUpdateSource({
				channel: "nightly",
				pin: { kind: "none" },
			})
		).toEqual({ channel: "nightly", kind: "channel" });
	});

	it("requires an allowed fixed-channel tag when a release must be pinned", () => {
		expect(
			resolveAppUpdateSource({
				channel: "stable",
				pin: { allowed: true, kind: "required", tag: "v0.2.1" },
			})
		).toEqual({ channel: "stable", kind: "tag", tag: "v0.2.1" });
		expect(
			resolveAppUpdateSource({
				channel: "stable",
				pin: { allowed: false, kind: "required", tag: "v0.2.1" },
			})
		).toBeNull();
		expect(
			resolveAppUpdateSource({
				channel: "canary",
				pin: { allowed: true, kind: "required", tag: "canary" },
			})
		).toBeNull();
	});
});
