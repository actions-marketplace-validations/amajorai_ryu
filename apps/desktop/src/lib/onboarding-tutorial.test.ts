import { describe, expect, it } from "bun:test";
import {
	EXTENSIONS_ROUTE,
	onboardingExtensionsRoute,
} from "./onboarding-tutorial.ts";

describe("onboarding extension hand-off", () => {
	it("opens the existing installed extensions surface", () => {
		expect(onboardingExtensionsRoute()).toBe("/extensions");
		expect(EXTENSIONS_ROUTE).toBe("/extensions");
	});
});
