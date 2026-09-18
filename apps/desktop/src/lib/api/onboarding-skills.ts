import type { ApiTarget } from "./client.ts";
import { request } from "./client.ts";

/** One optional external skill collection offered during node onboarding. */
export interface OnboardingSkillPackOption {
	description: string;
	id: string;
	name: string;
}

export interface OnboardingSkillsSnapshot {
	builtInNotice: string;
	canConfigure: boolean;
	configured: boolean;
	options: OnboardingSkillPackOption[];
	report?: unknown;
	selectedPackIds: string[];
	syncComplete?: boolean;
}

function normalize(
	payload: Partial<OnboardingSkillsSnapshot>,
	selectedPackIds: string[] = []
): OnboardingSkillsSnapshot {
	return {
		builtInNotice:
			payload.builtInNotice ??
			"Ryu's built-in skills and enabled plugin skills are not part of this selection.",
		canConfigure: payload.canConfigure ?? false,
		configured: payload.configured ?? false,
		options: payload.options ?? [],
		report: payload.report,
		selectedPackIds: payload.selectedPackIds ?? selectedPackIds,
		syncComplete: payload.syncComplete,
	};
}

/** Read the node-scoped optional skill collections and their effective choice. */
export async function fetchOnboardingSkills(
	target: ApiTarget
): Promise<OnboardingSkillsSnapshot> {
	const payload = await request<Partial<OnboardingSkillsSnapshot>>(
		target,
		"/api/onboarding/skills",
		{ signal: AbortSignal.timeout(15_000) }
	);
	return normalize(payload);
}

/** Save the node owner's/admin's selection and reconcile only those collections. */
export async function saveOnboardingSkillSelection(
	target: ApiTarget,
	selectedPackIds: string[]
): Promise<OnboardingSkillsSnapshot> {
	const payload = await request<Partial<OnboardingSkillsSnapshot>>(
		target,
		"/api/onboarding/skills",
		{
			body: { selectedPackIds },
			method: "PUT",
			signal: AbortSignal.timeout(5 * 60_000),
		}
	);
	return normalize(payload, selectedPackIds);
}
