/**
 * Best-effort model hover-card insight via Core (`/api/models/insight`).
 * Cascade: OpenRouter first for OpenRouter-routed models, models.dev otherwise,
 * then Artificial Analysis. Returns `null` when every source misses — the picker
 * simply skips the hover card.
 */

import type { ApiTarget } from "./client.ts";
import { request } from "./client.ts";

export interface ModelInsight {
	aaKeyPresent: boolean;
	aaMatchedName?: string | null;
	contextTokens?: number | null;
	costInputPer1m?: number | null;
	costOutputPer1m?: number | null;
	description?: string | null;
	id: string;
	intelligenceIndex?: number | null;
	knowledge?: string | null;
	maxOutputTokens?: number | null;
	modalitiesInput: string[];
	modalitiesOutput: string[];
	name: string;
	outputTokensPerSecond?: number | null;
	reasoning?: boolean | null;
	scoreContext?: number | null;
	scoreCost?: number | null;
	scoreIntelligence?: number | null;
	scoreSpeed?: number | null;
	source: string;
	timeToFirstTokenS?: number | null;
	toolCall?: boolean | null;
}

export async function getModelInsight(
	target: ApiTarget,
	model: string,
	provider?: string | null
): Promise<ModelInsight | null> {
	const trimmed = model.trim();
	if (!trimmed) {
		return null;
	}
	try {
		const params = new URLSearchParams({ model: trimmed });
		if (provider?.trim()) {
			params.set("provider", provider.trim());
		}
		const json = await request<{ insight?: ModelInsight | null }>(
			target,
			`/api/models/insight?${params.toString()}`
		);
		return json.insight ?? null;
	} catch {
		return null;
	}
}
