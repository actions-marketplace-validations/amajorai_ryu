import { describe, expect, test } from "bun:test";
import {
	buildOnboardingTaskRouteState,
	ONBOARDING_CHAT_ROUTE_STATE,
	onboardingInitialTab,
} from "./onboarding-navigation.ts";

describe("onboarding navigation", () => {
	test("seeds the first proactive Ryu chat after onboarding", () => {
		expect(onboardingInitialTab(ONBOARDING_CHAT_ROUTE_STATE)).toEqual({
			initialAgent: "ryu",
			initialProactiveOpening: true,
			path: "/chat",
			title: "Ryu chat",
		});
	});

	test("does not seed a chat for unrelated route state", () => {
		expect(onboardingInitialTab(undefined)).toBeUndefined();
		expect(onboardingInitialTab({ ryuOnboardingChat: false })).toBeUndefined();
	});

	test("seeds the paid onboarding task into the first chat", () => {
		const state = buildOnboardingTaskRouteState({
			prompt: "Review my recent Chorus calls.",
			title: "Prepare Chorus follow-ups",
		});
		expect(onboardingInitialTab(state)).toEqual({
			initialAgent: "ryu",
			initialPrompt: "Review my recent Chorus calls.",
			initialSubmit: true,
			path: "/chat",
			title: "Prepare Chorus follow-ups",
		});
	});
});
