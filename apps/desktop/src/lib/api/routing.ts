// apps/desktop/src/lib/api/routing.ts
//
// Typed client for Core's threshold model fallback (`/api/routing/*`) — the
// rules that say "when I'm nearly out of X, run Y instead".
//
// Two surfaces, one evaluator behind them:
//
//   GET /api/routing/advice  -> what the NEXT turn would do, given current
//                               headroom. Backs the composer's info bar.
//   GET/PUT /api/routing/policy -> the node's rule list, edited in the Gateway
//                               (node) settings dialog.
//
// `advice` is a pure read — asking never applies a rule — and it is the same
// evaluator, over the same cached signals, that the turn itself runs through in
// Core. That is the point: the bar cannot promise one thing and the turn do
// another. Signal reads are cached per source in Core (subscription windows 5
// min, provider balances 5 min, the Ryu $ wallet 60 s), so calling this once per
// turn costs a preference read and arithmetic, not vendor round-trips.

import type { ApiTarget } from "@/src/lib/api/client.ts";
import { request } from "@/src/lib/api/client.ts";
import type { AgentSelection } from "@/src/lib/api/preferences.ts";

/** Which signal family a rule watches. Each carries its threshold in ITS unit. */
export type RoutingCondition =
	| { source: "ryu_credits"; below_usd: number }
	| { source: "provider_credits"; provider_id: string; below_usd: number }
	| {
			source: "subscription_window";
			agent_id: string;
			/** Case-insensitive substring of the window label; "" = worst window. */
			window: string;
			/** Restrict to a model-scoped window (Claude's per-model weekly caps). */
			model?: string;
			remaining_below_percent: number;
	  };

/**
 * A fallback target. Deliberately the SAME `AgentSelection` every other
 * agent/model setting on this node uses, so the rule form is the existing
 * `AgentSelectionField` rather than a bespoke model dropdown — and so a rule can
 * express anything the composer's picker can. All-empty means "notify only,
 * change nothing".
 */
export type RoutingSelection = AgentSelection;

export interface RoutingRule {
	/** Only apply on turns run by these agents. Empty = any. */
	applies_to_agents: string[];
	enabled: boolean;
	/**
	 * What to run instead. Named `fallback`, not `then`: an object carrying a
	 * `then` key is treated as a promise by `await`, so a rule list would
	 * silently mis-resolve.
	 */
	fallback: RoutingSelection;
	id: string;
	/** Surface this rule in the composer info bar when it fires. */
	notify: boolean;
	when: RoutingCondition;
}

export interface RoutingPolicy {
	rules: RoutingRule[];
}

/**
 * The policy plus what a rule is allowed to name. `credit_providers` comes from
 * Core (which owns the balance readers) rather than a hand-copied list here —
 * only a few vendors expose a balance to an inference key, and a rule naming any
 * other provider would evaluate to "unknown" forever and read as broken.
 */
export interface RoutingPolicyView extends RoutingPolicy {
	credit_providers: string[];
}

/** How loudly a verdict speaks. `swap` is the only one that changes a turn. */
export type RoutingSeverity = "continue" | "warn" | "swap";

export interface RoutingTarget {
	agent_id: string;
	model: string;
}

/** The number behind a verdict, so the bar can show it. */
export interface RoutingSignalReading {
	label: string;
	threshold: number;
	unit: "usd" | "percent";
	value: number;
}

export interface RoutingAdvice {
	effective: RoutingTarget;
	original: RoutingTarget;
	reason?: string;
	rule_id?: string;
	severity: RoutingSeverity;
	signal?: RoutingSignalReading;
}

/** The empty selection — a notify-only rule. */
export function emptyRoutingSelection(): RoutingSelection {
	return {
		agent_id: "",
		provider: "",
		model: "",
		thinking_level: "",
		effort: "",
		access_mode: "",
	};
}

/**
 * What the next turn would do for `agentId` / `model`.
 *
 * Always resolves: Core answers 200 with `severity: "continue"` when no rule
 * fires, and a transport failure is treated the same way by the caller — a
 * routing check that cannot be made must never block or annotate a turn.
 */
export async function fetchRoutingAdvice(
	target: ApiTarget,
	agentId: string,
	model: string,
	atConversationStart: boolean
): Promise<RoutingAdvice> {
	const params = new URLSearchParams({
		agent_id: agentId,
		model,
		// A rule that swaps the AGENT only applies at a conversation start (an ACP
		// agent owns its session state), and Core applies that gate inside the
		// evaluator — so sending the flag is what makes the bar's prediction and
		// the turn's behaviour the same thing.
		at_conversation_start: String(atConversationStart),
	});
	return await request<RoutingAdvice>(target, `/api/routing/advice?${params}`);
}

/** The node's rule list, plus the providers a credit rule may name. */
export async function fetchRoutingPolicy(
	target: ApiTarget
): Promise<RoutingPolicyView> {
	return await request<RoutingPolicyView>(target, "/api/routing/policy");
}

/** Replace the node's rule list. Core drops its cached signal readings. */
export async function saveRoutingPolicy(
	target: ApiTarget,
	policy: RoutingPolicy
): Promise<void> {
	await request<unknown>(target, "/api/routing/policy", {
		method: "PUT",
		body: policy,
	});
}

/** Format a reading for the info bar, in whichever unit it came in. */
export function formatRoutingSignal(signal: RoutingSignalReading): string {
	return signal.unit === "usd"
		? `$${signal.value.toFixed(2)}`
		: `${Math.round(signal.value)}%`;
}
