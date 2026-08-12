// apps/desktop/src/lib/api/context-breakdown.ts
//
// Typed client for `GET /api/conversations/:id/context` — the per-category token
// attribution Core recorded for the last turn it assembled on a conversation
// (skills, tool definitions, memory, conversation history, …). Rendered by the
// Context workspace panel; see
// `apps/core/src/sidecar/adapters/context_breakdown.rs`.
//
// Core keeps this in a small in-memory cache, so `null` is the NORMAL answer for
// a conversation that has not run a turn in the current Core process — not an
// error. Transport failures resolve `null` too: the panel's empty state says the
// same thing either way, and a missing breakdown must never surface as a broken
// panel.

import type { ContextBreakdownData } from "@ryu/blocks/desktop/agent-elements/context-breakdown.tsx";
import { type ApiTarget, request } from "./client.ts";

/** Wire shape: Core serializes `ContextBreakdown` with camelCase fields. */
interface ContextResponse {
	breakdown?: ContextBreakdownData | null;
}

/**
 * The remembered context breakdown for a conversation, or `null` when Core has
 * none (fresh process, evicted, or the transport failed).
 */
export async function getContextBreakdown(
	target: ApiTarget,
	conversationId: string
): Promise<ContextBreakdownData | null> {
	try {
		const res = await request<ContextResponse>(
			target,
			`/api/conversations/${encodeURIComponent(conversationId)}/context`
		);
		return res.breakdown ?? null;
	} catch {
		return null;
	}
}
