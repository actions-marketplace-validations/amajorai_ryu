import { describe, expect, it } from "bun:test";
import { classifyBrowserDevice } from "./browser-device.ts";

const signals = (
	overrides: Partial<Parameters<typeof classifyBrowserDevice>[0]> = {}
) => ({
	maxTouchPoints: 0,
	platform: "Win32",
	userAgent:
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
	...overrides,
});

describe("classifyBrowserDevice", () => {
	it("keeps desktop Chrome on the computer path", () => {
		expect(classifyBrowserDevice(signals())).toEqual({
			browser: "chrome",
			isComputer: true,
			isIpad: false,
			isMobile: false,
		});
	});

	it("recognizes iPadOS Safari even with a desktop Mac user agent", () => {
		expect(
			classifyBrowserDevice(
				signals({
					maxTouchPoints: 5,
					platform: "MacIntel",
					userAgent:
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
				})
			)
		).toMatchObject({
			browser: "safari",
			isComputer: false,
			isIpad: true,
			isMobile: true,
		});
	});

	it("uses the mobile hint for an Android browser", () => {
		expect(
			classifyBrowserDevice(
				signals({
					platform: "Linux armv8l",
					userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36",
					userAgentDataMobile: true,
				})
			)
		).toMatchObject({ isComputer: false, isMobile: true });
	});
});
