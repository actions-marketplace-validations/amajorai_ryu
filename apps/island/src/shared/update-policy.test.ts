import { describe, expect, it } from "bun:test";
import {
	ELECTRON_UPDATE_INSTALL_OPTIONS,
	shouldAutoInstallDownloadedUpdate,
} from "./update-policy.ts";

describe("Electron update install policy", () => {
	it("runs the installer silently and relaunches the app", () => {
		expect(ELECTRON_UPDATE_INSTALL_OPTIONS).toEqual({
			isForceRunAfter: true,
			isSilent: true,
		});
	});

	it("auto-installs only for packaged apps with the shared toggle enabled", () => {
		expect(shouldAutoInstallDownloadedUpdate(true, true)).toBe(true);
		expect(shouldAutoInstallDownloadedUpdate(true, false)).toBe(false);
		expect(shouldAutoInstallDownloadedUpdate(false, true)).toBe(false);
	});
});
