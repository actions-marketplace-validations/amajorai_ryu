// apps/desktop/src/lib/api/usage.ts
//
// Per-agent subscription usage (the chat "usage bar"). When a subscription ACP
// agent is active in chat (Claude Code, Codex, Copilot, Grok, GLM), Core reads
// that CLI's own local credential and calls the vendor's usage endpoint,
// returning its rolling rate-limit windows plus the non-percent figures — credit
// balances, Codex's banked rate-limit resets and their per-credit expiry dates —
// à la CodexBar / openusage. Core owns all the provider logic + the
// never-refresh token safety; this is a thin typed reader.
//
// The endpoint always returns 200: refusals carry `available: false` + a
// `reason` rather than an error, so callers never branch on HTTP status — they
// hide the bar on `unsupported` and show a hint otherwise.

import type { ApiTarget } from "@/src/lib/api/client.ts";
import { request } from "@/src/lib/api/client.ts";

/** Why a snapshot has no live windows (mirrors Core's `UsageUnavailable`). */
export type UsageReason =
	| "unsupported"
	| "not_logged_in"
	| "token_expired"
	| "missing_scope"
	| "no_plan"
	| "rate_limited"
	| "error";

/** One rolling rate-limit window. `usedPercent` is 0–100. */
export interface UsageWindow {
	label: string;
	/**
	 * The model this window limits, when it is a per-model window rather than an
	 * account-wide one (Claude's Sonnet/Opus weekly limits, Codex's Spark pair).
	 * `null` = account-wide.
	 *
	 * Core reports this rather than leaving the client to infer it from the label:
	 * "a label that isn't Session or Weekly names a model" needs a closed set of
	 * non-model labels, and Copilot's `Chat`/`Completions` and Z.ai's `Daily` are
	 * exactly the entries that would be missed.
	 */
	model: string | null;
	resetsAt: string | null;
	usedPercent: number;
	/**
	 * The window's own length in seconds, when the vendor reports it. Lets the
	 * short label ("5h" / "7d") come from the data instead of matching a closed
	 * set of English labels.
	 */
	windowSeconds: number | null;
}

/** What a {@link UsageValue}'s number means, so it can be formatted correctly. */
export type UsageValueKind = "percent" | "dollars" | "count";

/** One figure on a {@link UsageMeter} row. */
export interface UsageValue {
	kind: UsageValueKind;
	number: number;
	/** Unit noun for the label ("credits", "available", "cap"), when it adds anything. */
	unit: string | null;
}

/**
 * A usage row that is NOT a 0–100 bar: a credit balance, the count of banked
 * rate-limit resets, extra-usage dollars, a web-search count. `expiresAt` carries
 * one date per underlying item — Codex's banked resets each expire on their own
 * date, so a single reset timestamp can't represent them.
 */
export interface UsageMeter {
	expiresAt: string[];
	label: string;
	resetsAt: string | null;
	values: UsageValue[];
}

/** Normalized usage snapshot for one agent. */
export interface UsageSnapshot {
	agentId: string;
	available: boolean;
	engine: string;
	extraUsageUsd: number | null;
	meters: UsageMeter[];
	plan: string | null;
	reason: UsageReason | null;
	/** Seconds to wait, from a rate-limited vendor's `Retry-After`. */
	retryAfterSeconds: number | null;
	windows: UsageWindow[];
}

/** Raw snake_case wire shape from Core. */
interface WireWindow {
	label: string;
	model?: string | null;
	resets_at?: string | null;
	used_percent: number;
	window_seconds?: number | null;
}

interface WireValue {
	kind: UsageValueKind;
	number: number;
	unit?: string | null;
}

interface WireMeter {
	expires_at?: string[] | null;
	label: string;
	resets_at?: string | null;
	values: WireValue[];
}

interface WireSnapshot {
	agent_id: string;
	available: boolean;
	engine: string;
	extra_usage_usd?: number | null;
	meters?: WireMeter[] | null;
	plan?: string | null;
	reason?: UsageReason | null;
	retry_after_seconds?: number | null;
	windows: WireWindow[];
}

function toSnapshot(wire: WireSnapshot): UsageSnapshot {
	return {
		agentId: wire.agent_id,
		engine: wire.engine,
		available: wire.available,
		plan: wire.plan ?? null,
		reason: wire.reason ?? null,
		windows: wire.windows.map((w) => ({
			label: w.label,
			usedPercent: w.used_percent,
			resetsAt: w.resets_at ?? null,
			windowSeconds: w.window_seconds ?? null,
			model: w.model ?? null,
		})),
		meters: (wire.meters ?? []).map((m) => ({
			label: m.label,
			values: m.values.map((v) => ({
				number: v.number,
				kind: v.kind,
				unit: v.unit ?? null,
			})),
			expiresAt: m.expires_at ?? [],
			resetsAt: m.resets_at ?? null,
		})),
		extraUsageUsd: wire.extra_usage_usd ?? null,
		retryAfterSeconds: wire.retry_after_seconds ?? null,
	};
}

/**
 * The engine substrings Core's `engine_for_agent` recognizes. Kept in lockstep
 * with that list: this side is only a poll filter, but a missing entry silently
 * hides a provider's bar.
 */
const USAGE_ENGINE_HINTS = [
	"claude",
	"codex",
	"copilot",
	"grok",
	"glm",
	"zai",
] as const;

/**
 * Cheap client-side guess of whether an agent has a readable subscription usage
 * window, mirroring Core's `engine_for_agent`. Used to gate the poll so we don't
 * hit the endpoint every few minutes for agents that will always answer
 * `unsupported` (Core is the source of truth — this is just a poll filter).
 */
export function supportsUsage(agentId: string | null | undefined): boolean {
	if (!agentId) {
		return false;
	}
	const id = agentId.toLowerCase();
	return USAGE_ENGINE_HINTS.some((hint) => id.includes(hint));
}

/**
 * Fetch the usage snapshot for one agent. `agentId` may be an `acp:`-prefixed id
 * (it's percent-encoded for the path).
 */
export async function fetchAgentUsage(
	target: ApiTarget,
	agentId: string
): Promise<UsageSnapshot> {
	const wire = await request<WireSnapshot>(
		target,
		`/api/agents/${encodeURIComponent(agentId)}/usage`
	);
	return toSnapshot(wire);
}
