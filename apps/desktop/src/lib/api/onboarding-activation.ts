import { BACKEND_URL, TOKEN_KEY } from "@/lib/auth-client.ts";

export const ONBOARDING_SOURCES = [
	"friend",
	"search",
	"social",
	"community",
	"youtube",
	"podcast",
	"newsletter",
	"work",
	"other",
] as const;
export type OnboardingSource = (typeof ONBOARDING_SOURCES)[number];

export interface ActivationRewardSummary {
	amountMicroUsd: number;
	completed: number;
	remaining: number;
}

export interface ActivationRewardClaim extends ActivationRewardSummary {
	granted: boolean;
	reason?: "cap_reached" | "duplicate";
}

const BASE = BACKEND_URL.replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = 15_000;

function authHeaders(): Record<string, string> {
	const token = localStorage.getItem(TOKEN_KEY);
	if (!token) {
		throw new Error("Sign in to finish onboarding.");
	}
	return {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${BASE}${path}`, {
		...init,
		headers: {
			...authHeaders(),
			...(init?.headers ?? {}),
		},
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as {
			error?: string;
			message?: string;
		};
		throw new Error(
			body.message ?? body.error ?? `Request failed (${response.status})`
		);
	}
	return (await response.json()) as T;
}

export async function saveOnboardingSource(
	source: OnboardingSource
): Promise<void> {
	await requestJson<{ source: OnboardingSource }>(
		"/api/profile/me/onboarding-source",
		{
			body: JSON.stringify({ source }),
			method: "PATCH",
		}
	);
}

export function fetchActivationRewardSummary(): Promise<ActivationRewardSummary> {
	return requestJson<ActivationRewardSummary>(
		"/api/onboarding/activation/rewards"
	);
}

export function claimActivationReward(input: {
	appSlug: string;
	connectionId: string;
}): Promise<ActivationRewardClaim> {
	return requestJson<ActivationRewardClaim>(
		"/api/onboarding/activation/rewards/claim",
		{
			body: JSON.stringify(input),
			method: "POST",
		}
	);
}
