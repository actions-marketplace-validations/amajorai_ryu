import {
	aggregateUsageEvents,
	type UsageAnalyticsData,
	type UsageBreakdownRow,
	type UsageEvent,
	type UsageGranularity,
	type UsageScope,
} from "@ryu/blocks/desktop/usage-analytics.ts";
import { BACKEND_URL, TOKEN_KEY } from "@/lib/auth-client.ts";
import type { ApiTarget } from "./client.ts";
import { fetchUsage, type UsageStats } from "./credits.ts";
import { fetchGatewayAudit } from "./gateway.ts";
import { fetchProfileStats, fetchUsageDaily } from "./profile.ts";

export interface UsageAnalyticsQuery {
	from: Date;
	granularity: UsageGranularity;
	model?: string | null;
	provider?: string | null;
	to: Date;
}

interface OrganizationUsageResponse {
	capped: boolean;
	events: Array<{
		error: boolean;
		inputTokens: number;
		latencyMs: number;
		memberId: string | null;
		model: string;
		nodeId: string;
		outputTokens: number;
		provider: string;
		requestId?: string | null;
		source?: UsageEvent["source"];
		timestamp: string;
	}>;
}

function authHeaders(): Record<string, string> {
	const token = localStorage.getItem(TOKEN_KEY);
	if (!token) {
		throw new Error("Sign in to view usage analytics.");
	}
	return { Authorization: `Bearer ${token}` };
}

function isoDay(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function pathForOrganization(
	orgId: string,
	query: UsageAnalyticsQuery
): string {
	const params = new URLSearchParams({
		from: query.from.toISOString(),
		until: query.to.toISOString(),
	});
	if (query.provider) {
		params.set("provider", query.provider);
	}
	if (query.model) {
		params.set("model", query.model);
	}
	return `${BACKEND_URL.replace(/\/$/, "")}/api/aggregation/orgs/${encodeURIComponent(orgId)}/usage/analytics?${params}`;
}

async function fetchOrganizationEvents(
	orgId: string,
	query: UsageAnalyticsQuery
): Promise<{
	capped: boolean;
	creditLedgerCapped: boolean;
	creditEvents: UsageEvent[];
	creditStats: UsageStats | null;
	events: UsageEvent[];
}> {
	const [response, creditUsage] = await Promise.all([
		fetch(pathForOrganization(orgId, query), {
			headers: authHeaders(),
			signal: AbortSignal.timeout(15_000),
		}),
		fetchUsage({
			limit: 200,
			model: query.model,
			provider: query.provider,
			since: query.from.toISOString(),
			until: new Date(query.to.getTime() - 1).toISOString(),
		}).catch(() => null),
	]);
	if (!response.ok) {
		throw new Error(
			`Organization analytics request failed (${response.status})`
		);
	}
	const body = (await response.json()) as OrganizationUsageResponse;
	return {
		capped: body.capped,
		creditLedgerCapped: Boolean(creditUsage?.nextCursor),
		creditEvents:
			creditUsage?.entries
				.filter((entry) => entry.delta < 0)
				.map((entry) => ({
					costMicroUsd: Math.abs(entry.delta),
					durationMs: entry.durationMs,
					feature: entry.taskLabel,
					inputTokens: entry.inputTokens ?? 0,
					memberId: entry.userId,
					model: entry.model,
					nodeId: null,
					outputTokens: entry.outputTokens ?? 0,
					provider: entry.provider,
					requestId: entry.refId,
					requestCount: 0,
					source: "managed",
					timestamp: entry.createdAt,
				})) ?? [],
		creditStats: creditUsage?.stats ?? null,
		events: body.events.map((event) => ({
			durationMs: event.latencyMs,
			error: event.error,
			inputTokens: event.inputTokens,
			memberId: event.memberId,
			model: event.model,
			nodeId: event.nodeId,
			outputTokens: event.outputTokens,
			provider: event.provider,
			requestId: event.requestId,
			source: event.source,
			timestamp: event.timestamp,
		})),
	};
}

export function withoutDuplicateManagedCharges(
	auditEvents: UsageEvent[],
	creditEvents: UsageEvent[]
): UsageEvent[] {
	const auditRequestIds = new Set(
		auditEvents
			.map((event) => event.requestId)
			.filter((requestId): requestId is string => Boolean(requestId))
	);
	return creditEvents.filter(
		(event) => !(event.requestId && auditRequestIds.has(event.requestId))
	);
}

function overlaySpendRows(
	rows: UsageBreakdownRow[],
	ledgerRows: UsageStats["byModel"] | UsageStats["byProvider"]
): UsageBreakdownRow[] {
	const spendByKey = new Map<string, number>();
	for (const row of ledgerRows) {
		if (row.amountMicroUsd <= 0) {
			continue;
		}
		const key = row.key ?? "Unknown";
		spendByKey.set(key, (spendByKey.get(key) ?? 0) + row.amountMicroUsd);
	}
	const merged = rows.map((row) => ({
		...row,
		spendMicroUsd: spendByKey.get(row.key) ?? row.spendMicroUsd,
	}));
	for (const [key, spendMicroUsd] of spendByKey) {
		if (merged.some((row) => row.key === key)) {
			continue;
		}
		merged.push({
			key,
			label: key,
			requests: 0,
			spendMicroUsd,
			tokens: 0,
		});
	}
	return merged.sort(
		(a, b) =>
			b.requests - a.requests || (b.spendMicroUsd ?? 0) - (a.spendMicroUsd ?? 0)
	);
}

function overlayCreditSpend(
	data: UsageAnalyticsData,
	stats: UsageStats | null
): UsageAnalyticsData {
	if (!stats || stats.transactions === 0) {
		return data;
	}
	const managedSource = data.bySource.find((row) => row.key === "managed");
	const bySource = managedSource
		? data.bySource.map((row) =>
				row.key === "managed"
					? { ...row, spendMicroUsd: stats.spentMicroUsd }
					: row
			)
		: [
				...data.bySource,
				{
					key: "managed",
					label: "Managed credits",
					requests: 0,
					spendMicroUsd: stats.spentMicroUsd,
					tokens: 0,
				},
			];
	return {
		...data,
		byModel: overlaySpendRows(data.byModel, stats.byModel),
		byProvider: overlaySpendRows(data.byProvider, stats.byProvider),
		bySource,
		totals: { ...data.totals, spendMicroUsd: stats.spentMicroUsd },
	};
}

function nodeSourceFor(
	provider: string | null,
	managed: boolean,
	localNode: boolean
): UsageEvent["source"] {
	const normalized = provider?.toLowerCase();
	if (
		normalized === "local" ||
		normalized === "ollama" ||
		normalized === "llamacpp" ||
		normalized === "lmstudio" ||
		normalized === "vllm"
	) {
		return "local";
	}
	if (
		normalized === "openai" ||
		normalized === "anthropic" ||
		normalized === "genai" ||
		normalized === "openrouter"
	) {
		return "byok";
	}
	if (managed) {
		return "managed";
	}
	return localNode ? "byok" : "self_hosted";
}

async function fetchNodeEvents(
	target: ApiTarget,
	query: UsageAnalyticsQuery,
	managed: boolean,
	localNode: boolean
): Promise<{ reachable: boolean; events: UsageEvent[] }> {
	const response = await fetchGatewayAudit(
		target,
		{
			from: query.from.toISOString(),
			limit: 1000,
			model: query.model ?? undefined,
			provider: query.provider ?? undefined,
			until: query.to.toISOString(),
		},
		undefined
	);
	return {
		reachable: response.reachable,
		events: response.entries.map((entry) => ({
			durationMs: entry.latency_ms,
			costMicroUsd: entry.cost_micro_usd,
			error: Boolean(entry.error),
			feature: entry.feature,
			inputTokens: entry.input_tokens ?? 0,
			memberId: entry.user_id,
			model: entry.model,
			outputTokens: entry.output_tokens ?? 0,
			provider: entry.provider,
			source: entry.source ?? nodeSourceFor(entry.provider, managed, localNode),
			timestamp: entry.timestamp,
		})),
	};
}

function unavailableAnalytics(
	query: UsageAnalyticsQuery,
	scope: UsageScope,
	scopeLabel: string,
	caption: string,
	message: string
): UsageAnalyticsData {
	const data = aggregateUsageEvents({
		caption,
		events: [],
		from: query.from,
		granularity: query.granularity,
		scope,
		scopeLabel,
		to: query.to,
	});
	return {
		...data,
		availability: { message, supported: false },
	};
}

function addPersonalBreakdowns(
	data: UsageAnalyticsData,
	stats: Awaited<ReturnType<typeof fetchProfileStats>>
): UsageAnalyticsData {
	const toRow = (key: string, requests: number): UsageBreakdownRow => ({
		key,
		label: key,
		requests,
		spendMicroUsd: null,
		tokens: 0,
	});
	const providerRows = [
		toRow("Gateway", stats.insights.transport.gateway),
		toRow("ACP", stats.insights.transport.acp),
		toRow("OpenAI-compatible", stats.insights.transport.openAiCompat),
	].filter((entry) => entry.requests > 0);
	return {
		...data,
		byModel: stats.insights.topModels.map((entry) =>
			toRow(entry.id, entry.count)
		),
		byProvider: providerRows,
		bySource: [toRow("unknown", data.totals.requests)],
		modelOptions: stats.insights.topModels.map((entry) => entry.id),
		providerOptions: providerRows.map((entry) => entry.key),
	};
}

async function fetchPersonalAnalytics(
	query: UsageAnalyticsQuery
): Promise<UsageAnalyticsData> {
	const stats = await fetchProfileStats();
	if (query.provider || query.model) {
		return addPersonalBreakdowns(
			unavailableAnalytics(
				query,
				"you",
				"You",
				"Everything you’ve consumed, regardless of org or node.",
				"Personal rollups do not retain provider and model dimensions yet. Clear the filter or switch to Organization or This node for a filtered breakdown."
			),
			stats
		);
	}
	if (query.granularity === "15m" || query.granularity === "hourly") {
		return addPersonalBreakdowns(
			unavailableAnalytics(
				query,
				"you",
				"You",
				"Everything you’ve consumed, regardless of org or node.",
				"Personal fine-grained history is not reported by the profile rollup yet. Choose daily, weekly, or monthly, or inspect This node for interval traffic."
			),
			stats
		);
	}

	const response = await fetchUsageDaily(isoDay(query.from), isoDay(query.to));
	const events: UsageEvent[] = response.days.map((day) => ({
		outputTokens: day.tokens,
		requestCount: day.count,
		timestamp: `${day.day}T12:00:00.000Z`,
	}));
	const data = aggregateUsageEvents({
		caption: "Everything you’ve consumed, regardless of org or node.",
		events,
		from: query.from,
		granularity: query.granularity,
		scope: "you",
		scopeLabel: "You",
		to: query.to,
	});
	return addPersonalBreakdowns(data, stats);
}

export async function fetchUsageAnalytics(
	query: UsageAnalyticsQuery,
	{
		activeNode,
		activeOrgId,
		scope,
	}: {
		activeNode: (ApiTarget & { local?: boolean; managed?: boolean }) | null;
		activeOrgId: string | null;
		scope: UsageScope;
	}
): Promise<UsageAnalyticsData> {
	if (scope === "you") {
		return fetchPersonalAnalytics(query);
	}
	if (scope === "organization") {
		if (!activeOrgId) {
			return unavailableAnalytics(
				query,
				"organization",
				"Organization",
				"All members and nodes in the active organization.",
				"Select an organization to view organization analytics."
			);
		}
		const result = await fetchOrganizationEvents(activeOrgId, query);
		const data = aggregateUsageEvents({
			caption: "All members and nodes in the active organization.",
			events: [
				...result.events,
				...withoutDuplicateManagedCharges(result.events, result.creditEvents),
			],
			from: query.from,
			granularity: query.granularity,
			scope: "organization",
			scopeLabel: "Organization",
			to: query.to,
		});
		const withCreditSpend = overlayCreditSpend(data, result.creditStats);
		const availabilityMessages = [
			result.capped
				? "This range is capped to the most recent 20,000 events."
				: null,
			result.creditLedgerCapped
				? "Credit spend timeline is capped to the most recent 200 ledger debits; totals and breakdowns remain exact."
				: null,
		].filter((message): message is string => message !== null);
		return availabilityMessages.length > 0
			? {
					...withCreditSpend,
					availability: {
						message: availabilityMessages.join(" "),
						supported: true,
					},
				}
			: withCreditSpend;
	}
	if (!activeNode) {
		return unavailableAnalytics(
			query,
			"node",
			"This node",
			"Only usage routed through the selected node.",
			"Select a node to view node analytics."
		);
	}
	const result = await fetchNodeEvents(
		activeNode,
		query,
		Boolean(activeNode.managed),
		Boolean(activeNode.local)
	);
	if (!result.reachable) {
		return unavailableAnalytics(
			query,
			"node",
			"This node",
			"Only usage routed through the selected node.",
			"This node is offline or its audit history is unavailable."
		);
	}
	return aggregateUsageEvents({
		caption: "Only usage routed through the selected node.",
		events: result.events,
		from: query.from,
		granularity: query.granularity,
		scope: "node",
		scopeLabel: "This node",
		to: query.to,
	});
}
