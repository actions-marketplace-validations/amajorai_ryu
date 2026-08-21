// apps/desktop/src/lib/api/integrations.ts
//
// Client for the merged Integrations catalog (`GET /api/integrations`). Core
// unions the integrations.sh directory with Composio's toolkit catalog and
// Treg's public platform catalog into one brand-per-service list, deduped by
// slug and paginated with a real offset
// cursor (so the whole registry loads, not just the first page). Each brand is
// the front door to everything that connects to that service.

import { type ApiTarget, request } from "./client.ts";

/** One concrete connection a brand offers, straight from a directory record.
 *  This is the actionable form of `feeds`: the record `id` is what Core's
 *  OpenAPI importer resolves against apis.guru, and `url` is the setup/endpoint
 *  URL. Without these two fields every connection is only a chip. */
export interface IntegrationConnection {
	/** Directory record id (`openapi/1password-com-events`, `mcp/notion`). */
	id: string;
	/** `mcp` / `openapi` / `api` / `graphql` / `cli`. */
	kind: string;
	name: string;
	url: string | null;
}

/** A provider-level choice surfaced by the merged preview. */
export interface IntegrationOption {
	action: string;
	availabilityNote: string | null;
	available: boolean | null;
	capability: string | null;
	comparisonKey: string | null;
	connectionId: string | null;
	description: string | null;
	id: string;
	isCheapest: boolean;
	kind: string;
	name: string;
	price: IntegrationPrice | null;
	provider: string | null;
	source: string;
	url: string | null;
}

export interface IntegrationPrice {
	confidence: string | null;
	currency: string | null;
	per: number | null;
	unit: string | null;
	usd: number | null;
	value: number | null;
}

interface IntegrationOptionWire {
	action?: string;
	availability_note?: string | null;
	available?: boolean | null;
	capability?: string | null;
	comparison_key?: string | null;
	connection_id?: string | null;
	description?: string | null;
	id?: string;
	is_cheapest?: boolean;
	kind?: string;
	name?: string;
	price?: {
		confidence?: string | null;
		currency?: string | null;
		per?: number | null;
		unit?: string | null;
		usd?: number | null;
		value?: number | null;
	} | null;
	provider?: string | null;
	source?: string;
	url?: string | null;
}

interface IntegrationBrandWire extends Omit<IntegrationBrand, "options"> {
	options?: IntegrationOptionWire[];
}

function mapIntegrationBrand(brand: IntegrationBrandWire): IntegrationBrand {
	return {
		...brand,
		options: (brand.options ?? []).map((option) => ({
			action: option.action ?? "chat-setup",
			available: option.available ?? null,
			availabilityNote: option.availability_note ?? null,
			capability: option.capability ?? null,
			comparisonKey: option.comparison_key ?? null,
			connectionId: option.connection_id ?? null,
			description: option.description ?? null,
			id: option.id ?? "",
			isCheapest: option.is_cheapest ?? false,
			kind: option.kind ?? "",
			name: option.name ?? option.id ?? "",
			price: option.price
				? {
						confidence: option.price.confidence ?? null,
						currency: option.price.currency ?? null,
						per: option.price.per ?? null,
						unit: option.price.unit ?? null,
						usd: option.price.usd ?? null,
						value: option.price.value ?? null,
					}
				: null,
			provider: option.provider ?? null,
			source: option.source ?? "",
			url: option.url ?? null,
		})),
	};
}

/** One service/brand (Notion, Slack, …) merged across catalog sources. */
export interface IntegrationBrand {
	categories: string[];
	/** Every directory record folded into this brand, deduped by record id. */
	connections: IntegrationConnection[];
	description: string | null;
	domain: string | null;
	/** Integration kinds available from the directory (mcp/api/graphql/cli). */
	feeds: string[];
	/** Stable slug (lowercase, non-alphanumerics stripped) — also the detail id. */
	id: string;
	/** A logo URL (raster). */
	logo: string | null;
	name: string;
	/** One unified preview list: integrations.sh records, Composio toolkits, and
	 * Treg endpoints/platforms. */
	options: IntegrationOption[];
	popularity: number | null;
	/** Which catalogs surfaced this brand: "directory", "composio", and/or "treg". */
	sources: string[];
}

export interface IntegrationsPage {
	integrations: IntegrationBrand[];
	/** Offset cursor for the next page, or null at the end. */
	nextCursor: string | null;
	total: number;
}

export interface IntegrationsSearchParams {
	cursor?: string;
	limit?: number;
	query?: string;
}

/** Search/browse the merged brand catalog (server-side filter + offset cursor). */
export async function searchIntegrations(
	target: ApiTarget,
	params: IntegrationsSearchParams = {}
): Promise<IntegrationsPage> {
	const q = new URLSearchParams();
	if (params.query) {
		q.set("q", params.query);
	}
	if (params.limit) {
		q.set("limit", String(params.limit));
	}
	if (params.cursor) {
		q.set("cursor", params.cursor);
	}
	const json = await request<{
		integrations?: IntegrationBrandWire[];
		next_cursor?: string | null;
		total?: number;
	}>(target, `/api/integrations?${q.toString()}`);
	return {
		integrations: (json.integrations ?? []).map(mapIntegrationBrand),
		nextCursor: json.next_cursor ?? null,
		total: json.total ?? 0,
	};
}

/** Fetch a single brand by slug. */
export async function fetchIntegration(
	target: ApiTarget,
	id: string
): Promise<IntegrationBrand> {
	const brand = await request<IntegrationBrandWire>(
		target,
		`/api/integrations/${encodeURIComponent(id)}`
	);
	return mapIntegrationBrand(brand);
}
