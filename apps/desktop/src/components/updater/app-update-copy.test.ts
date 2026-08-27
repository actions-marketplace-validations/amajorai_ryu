import { describe, expect, it } from "bun:test";
import { SETTINGS_ENTRIES, searchSettings } from "@/src/lib/settings-index.ts";
import {
	APP_UPDATE_DOWNLOAD_ARIA_LABEL,
	APP_UPDATE_DOWNLOAD_DESCRIPTION,
	APP_UPDATE_DOWNLOAD_TITLE,
	APP_UPDATE_INSTALL_ACTION,
} from "./app-update-policy.ts";

describe("desktop app update copy", () => {
	it("explains that background downloading still asks before install", () => {
		expect(APP_UPDATE_DOWNLOAD_TITLE).toBe("Download updates automatically");
		expect(APP_UPDATE_DOWNLOAD_DESCRIPTION).toBe(
			"Download updates in the background. Ryu asks before installing and restarting."
		);
		expect(APP_UPDATE_DOWNLOAD_ARIA_LABEL).toBe(
			"Download app updates automatically"
		);
		expect(APP_UPDATE_INSTALL_ACTION).toBe("Install and restart");
	});

	it("makes the new preference discoverable from app settings search", () => {
		const entry = SETTINGS_ENTRIES.find(
			(candidate) => candidate.id === "updates.automatic-updates"
		);
		expect(entry?.label).toBe("Download updates automatically");
		expect(entry?.keywords).toContain(
			"background download ready install restart"
		);
		expect(searchSettings("background download")[0]?.id).toBe(
			"updates.automatic-updates"
		);
	});
});
