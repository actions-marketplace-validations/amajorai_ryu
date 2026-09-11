import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}

import { afterEach, describe, expect, it } from "bun:test";
import {
	AFK_TIMEOUT_OPTIONS,
	DEFAULT_USER_AVAILABILITY_SETTINGS,
	resolveUserAvailability,
	setAfkDetectionEnabled,
	setAfkTimeoutMinutes,
	setUserAvailabilityStatus,
	USER_AVAILABILITY_STORAGE_KEY,
} from "./user-availability.ts";

const recentActivityAt = 1_000_000;

afterEach(() => {
	localStorage.removeItem(USER_AVAILABILITY_STORAGE_KEY);
	setUserAvailabilityStatus("online");
	setAfkDetectionEnabled(true);
	setAfkTimeoutMinutes(DEFAULT_USER_AVAILABILITY_SETTINGS.afkTimeoutMinutes);
});

describe("resolveUserAvailability", () => {
	it("keeps manual Away and Do not disturb independent of AFK timing", () => {
		const now = recentActivityAt + 60 * 60_000;

		expect(
			resolveUserAvailability(
				{ ...DEFAULT_USER_AVAILABILITY_SETTINGS, manualStatus: "away" },
				now,
				recentActivityAt,
				true
			)
		).toEqual({ source: "manual", status: "away" });
		expect(
			resolveUserAvailability(
				{
					...DEFAULT_USER_AVAILABILITY_SETTINGS,
					manualStatus: "do-not-disturb",
				},
				now,
				recentActivityAt,
				false
			)
		).toEqual({ source: "manual", status: "do-not-disturb" });
	});

	it("turns Online into Away after the configured timeout", () => {
		const settings = {
			...DEFAULT_USER_AVAILABILITY_SETTINGS,
			afkTimeoutMinutes: 5 as const,
		};

		expect(
			resolveUserAvailability(
				settings,
				recentActivityAt + 5 * 60_000,
				recentActivityAt,
				true
			)
		).toEqual({ source: "afk", status: "away" });
	});

	it("treats an unfocused window as Away immediately", () => {
		expect(
			resolveUserAvailability(
				DEFAULT_USER_AVAILABILITY_SETTINGS,
				recentActivityAt + 1000,
				recentActivityAt,
				false
			)
		).toEqual({ source: "afk", status: "away" });
	});

	it("leaves Online alone when AFK detection is disabled", () => {
		expect(
			resolveUserAvailability(
				{ ...DEFAULT_USER_AVAILABILITY_SETTINGS, afkDetectionEnabled: false },
				recentActivityAt + 60 * 60_000,
				recentActivityAt,
				false
			)
		).toEqual({ source: "manual", status: "online" });
	});
});

describe("availability persistence", () => {
	it("persists allowlisted manual status and AFK timeout values", () => {
		setUserAvailabilityStatus("away");
		setAfkDetectionEnabled(false);
		setAfkTimeoutMinutes(AFK_TIMEOUT_OPTIONS[0]);

		const stored = JSON.parse(
			localStorage.getItem(USER_AVAILABILITY_STORAGE_KEY) ?? "{}"
		) as Record<string, unknown>;
		expect(stored).toMatchObject({
			afkDetectionEnabled: false,
			afkTimeoutMinutes: 5,
			manualStatus: "away",
		});
	});
});
