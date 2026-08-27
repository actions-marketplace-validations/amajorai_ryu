import type { InitialTab } from "@/src/contexts/TabsContext.tsx";

const ONBOARDING_CHAT_STATE_KEY = "ryuOnboardingChat";
const ONBOARDING_TASK_STATE_KEY = "ryuOnboardingTask";

export const ONBOARDING_CHAT_ROUTE_STATE = {
	[ONBOARDING_CHAT_STATE_KEY]: true,
} as const;

export interface OnboardingTaskSeed {
	prompt: string;
	title: string;
}

export function buildOnboardingTaskRouteState(seed: OnboardingTaskSeed) {
	return {
		...ONBOARDING_CHAT_ROUTE_STATE,
		[ONBOARDING_TASK_STATE_KEY]: {
			initialPrompt: seed.prompt,
			title: seed.title,
		},
	} as const;
}

export function onboardingInitialTab(state: unknown): InitialTab | undefined {
	if (typeof state !== "object" || state === null) {
		return undefined;
	}
	const record = state as Record<string, unknown>;
	if (record[ONBOARDING_CHAT_STATE_KEY] !== true) {
		return undefined;
	}
	const task =
		typeof record[ONBOARDING_TASK_STATE_KEY] === "object" &&
		record[ONBOARDING_TASK_STATE_KEY] !== null
			? record[ONBOARDING_TASK_STATE_KEY]
			: null;
	const taskPrompt =
		task && "initialPrompt" in task && typeof task.initialPrompt === "string"
			? task.initialPrompt
			: undefined;
	const taskTitle =
		task && "title" in task && typeof task.title === "string"
			? task.title
			: undefined;

	return {
		initialAgent: "ryu",
		...(taskPrompt
			? { initialPrompt: taskPrompt, initialSubmit: true }
			: { initialProactiveOpening: true }),
		path: "/chat",
		title: taskTitle ?? "Ryu chat",
	};
}
