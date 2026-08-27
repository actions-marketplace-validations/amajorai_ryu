export const USAGE_SCOPES = ["you", "organization", "node"] as const;
export type UsageScope = (typeof USAGE_SCOPES)[number];

export const USAGE_GRANULARITIES = [
	"15m",
	"hourly",
	"daily",
	"weekly",
	"monthly",
] as const;
export type UsageGranularity = (typeof USAGE_GRANULARITIES)[number];

export type UsageSource =
	| "managed"
	| "byok"
	| "self_hosted"
	| "local"
	| "unknown";

export interface UsageDateRange {
	from: Date;
	to: Date;
}

export interface UsageEvent {
	agentSeconds?: number;
	/** Width of a server-owned aggregate represented by this event. */
	bucketSeconds?: number;
	costMicroUsd?: number | null;
	durationMs?: number | null;
	error?: boolean;
	errorCount?: number;
	feature?: string | null;
	inputTokens?: number;
	latencySamples?: number;
	latencyTotalMs?: number;
	memberId?: string | null;
	model?: string | null;
	nodeId?: string | null;
	organizationId?: string | null;
	outputTokens?: number;
	provider?: string | null;
	requestCount?: number;
	/** Stable request identity used to join audit events with billing rows. */
	requestId?: string | null;
	source?: UsageSource | null;
	/** ISO timestamp for the start of the observed request. */
	timestamp: string;
}

export interface UsageBucket {
	averageLatencyMs: number | null;
	end: string;
	errors: number;
	inputTokens: number;
	label: string;
	outputTokens: number;
	requests: number;
	spendMicroUsd: number | null;
	start: string;
}

export interface UsageTrendPoint {
	errors: number;
	label: string;
	requests: number;
	spend: number | null;
	tokens: number;
}

/** Bound chart work while preserving exact totals for long, detailed ranges. */
export function compactUsageTrendPoints(
	points: UsageTrendPoint[],
	maximumPoints = 1000
): UsageTrendPoint[] {
	if (maximumPoints < 1 || points.length <= maximumPoints) {
		return maximumPoints < 1 ? [] : points;
	}
	const groupSize = Math.ceil(points.length / maximumPoints);
	const compacted: UsageTrendPoint[] = [];
	for (let index = 0; index < points.length; index += groupSize) {
		const group = points.slice(index, index + groupSize);
		const first = group[0];
		const last = group.at(-1);
		if (!(first && last)) {
			continue;
		}
		let spend: number | null = null;
		let errors = 0;
		let requests = 0;
		let tokens = 0;
		for (const point of group) {
			errors += point.errors;
			requests += point.requests;
			tokens += point.tokens;
			if (point.spend !== null) {
				spend = (spend ?? 0) + point.spend;
			}
		}
		compacted.push({
			errors,
			label: first === last ? first.label : `${first.label} – ${last.label}`,
			requests,
			spend,
			tokens,
		});
	}
	return compacted;
}

export interface UsageBreakdownRow {
	key: string;
	label: string;
	requests: number;
	spendMicroUsd: number | null;
	tokens: number;
}

export interface UsageAnalyticsTotals {
	activeDays: number;
	activeMembers: number;
	activeNodes: number;
	agentSeconds: number;
	averageLatencyMs: number | null;
	errors: number;
	inputTokens: number;
	outputTokens: number;
	requests: number;
	spendMicroUsd: number | null;
}

export interface UsageAnalyticsData {
	availability?: {
		message?: string;
		supported: boolean;
	};
	buckets: UsageBucket[];
	byFeature: UsageBreakdownRow[];
	byModel: UsageBreakdownRow[];
	byProvider: UsageBreakdownRow[];
	bySource: UsageBreakdownRow[];
	caption: string;
	from: string;
	granularity: UsageGranularity;
	modelOptions: string[];
	providerOptions: string[];
	scope: UsageScope;
	scopeLabel: string;
	to: string;
	totals: UsageAnalyticsTotals;
}

export const GRANULARITY_LABELS: Record<UsageGranularity, string> = {
	"15m": "15 min",
	daily: "Daily",
	hourly: "Hourly",
	monthly: "Monthly",
	weekly: "Weekly",
};

export const SOURCE_LABELS: Record<UsageSource, string> = {
	byok: "BYOK",
	local: "Local",
	managed: "Managed credits",
	self_hosted: "Self-hosted",
	unknown: "Other",
};

const GRANULARITY_MS: Record<UsageGranularity, number> = {
	"15m": 15 * 60 * 1000,
	hourly: 60 * 60 * 1000,
	daily: 24 * 60 * 60 * 1000,
	weekly: 7 * 24 * 60 * 60 * 1000,
	monthly: 0,
};

const numberOrZero = (value: number | undefined): number =>
	Number.isFinite(value) ? (value ?? 0) : 0;

function startOfUtcMonth(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfUtcWeek(date: Date): Date {
	const start = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
	);
	const day = start.getUTCDay();
	const daysFromMonday = day === 0 ? 6 : day - 1;
	start.setUTCDate(start.getUTCDate() - daysFromMonday);
	return start;
}

export function bucketStartFor(
	date: Date,
	granularity: UsageGranularity
): Date {
	if (granularity === "monthly") {
		return startOfUtcMonth(date);
	}
	if (granularity === "weekly") {
		return startOfUtcWeek(date);
	}
	const interval = GRANULARITY_MS[granularity];
	return new Date(Math.floor(date.getTime() / interval) * interval);
}

export function nextBucketStart(
	date: Date,
	granularity: UsageGranularity
): Date {
	if (granularity === "monthly") {
		return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
	}
	if (granularity === "weekly") {
		return new Date(date.getTime() + GRANULARITY_MS.weekly);
	}
	return new Date(date.getTime() + GRANULARITY_MS[granularity]);
}

function formatBucketLabel(date: Date, granularity: UsageGranularity): string {
	const options: Intl.DateTimeFormatOptions =
		granularity === "15m" || granularity === "hourly"
			? { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" }
			: granularity === "monthly"
				? { month: "short", year: "numeric" }
				: { day: "numeric", month: "short" };
	return new Intl.DateTimeFormat(undefined, options).format(date);
}

function labelForKey(key: string, granularity: UsageGranularity): string {
	return formatBucketLabel(new Date(key), granularity);
}

function cleanKey(value: string | null | undefined, fallback: string): string {
	const trimmed = value?.trim();
	return trimmed ? trimmed : fallback;
}

interface MutableBreakdown {
	knownSpend: boolean;
	requests: number;
	spendMicroUsd: number;
	tokens: number;
}

interface MutableBucket extends MutableBreakdown {
	agentSeconds: number;
	end: Date;
	errors: number;
	inputTokens: number;
	latencyMs: number;
	latencySamples: number;
	memberIds: Set<string>;
	nodeIds: Set<string>;
	outputTokens: number;
}

function newBreakdown(): MutableBreakdown {
	return { knownSpend: false, requests: 0, spendMicroUsd: 0, tokens: 0 };
}

function addBreakdown(
	map: Map<string, MutableBreakdown>,
	key: string,
	event: UsageEvent,
	requests: number,
	tokens: number
): void {
	const breakdown = map.get(key) ?? newBreakdown();
	breakdown.requests += requests;
	breakdown.tokens += tokens;
	if (event.costMicroUsd !== null && event.costMicroUsd !== undefined) {
		breakdown.knownSpend = true;
		breakdown.spendMicroUsd += numberOrZero(event.costMicroUsd);
	}
	map.set(key, breakdown);
}

function toRows(
	map: Map<string, MutableBreakdown>,
	labels?: Record<string, string>
): UsageBreakdownRow[] {
	return [...map.entries()]
		.map(([key, value]) => ({
			key,
			label: labels?.[key] ?? key,
			requests: value.requests,
			spendMicroUsd: value.knownSpend ? value.spendMicroUsd : null,
			tokens: value.tokens,
		}))
		.sort((a, b) => b.requests - a.requests || b.tokens - a.tokens)
		.slice(0, 8);
}

function addSpend(target: MutableBucket, event: UsageEvent): void {
	if (event.costMicroUsd === null || event.costMicroUsd === undefined) {
		return;
	}
	target.knownSpend = true;
	target.spendMicroUsd += numberOrZero(event.costMicroUsd);
}

function addErrors(
	target: MutableBucket,
	event: UsageEvent,
	requests: number
): void {
	if (event.errorCount !== undefined) {
		target.errors += Math.max(0, numberOrZero(event.errorCount));
		return;
	}
	target.errors += event.error ? requests : 0;
}

function addLatency(target: MutableBucket, event: UsageEvent): void {
	if (
		event.latencyTotalMs !== undefined &&
		event.latencySamples !== undefined &&
		Number.isFinite(event.latencyTotalMs) &&
		Number.isFinite(event.latencySamples) &&
		event.latencySamples > 0
	) {
		target.latencyMs += Math.max(0, event.latencyTotalMs);
		target.latencySamples += event.latencySamples;
		return;
	}
	if (
		event.durationMs !== null &&
		event.durationMs !== undefined &&
		Number.isFinite(event.durationMs)
	) {
		target.latencyMs += Math.max(0, event.durationMs);
		target.latencySamples += 1;
	}
}

export function aggregateUsageEvents({
	events,
	from,
	granularity,
	scope,
	to,
	scopeLabel,
	caption,
}: {
	caption: string;
	events: UsageEvent[];
	from: Date;
	granularity: UsageGranularity;
	scope: UsageScope;
	scopeLabel: string;
	to: Date;
}): UsageAnalyticsData {
	const firstBucket = bucketStartFor(from, granularity);
	const buckets = new Map<string, MutableBucket>();
	const byProvider = new Map<string, MutableBreakdown>();
	const byModel = new Map<string, MutableBreakdown>();
	const bySource = new Map<string, MutableBreakdown>();
	const byFeature = new Map<string, MutableBreakdown>();
	const activeDateKeys = new Set<string>();

	for (
		let cursor = firstBucket;
		cursor < to;
		cursor = nextBucketStart(cursor, granularity)
	) {
		const end = nextBucketStart(cursor, granularity);
		buckets.set(cursor.toISOString(), {
			...newBreakdown(),
			agentSeconds: 0,
			end,
			errors: 0,
			inputTokens: 0,
			latencyMs: 0,
			latencySamples: 0,
			memberIds: new Set(),
			nodeIds: new Set(),
			outputTokens: 0,
		});
	}

	for (const event of events) {
		const date = new Date(event.timestamp);
		const bucketSeconds = Math.max(0, numberOrZero(event.bucketSeconds));
		const overlapsStart =
			date >= from || date.getTime() + bucketSeconds * 1000 > from.getTime();
		if (!(Number.isFinite(date.getTime()) && overlapsStart) || date >= to) {
			continue;
		}
		const start = bucketStartFor(date, granularity);
		const bucket = buckets.get(start.toISOString());
		if (!bucket) {
			continue;
		}
		activeDateKeys.add(date.toISOString().slice(0, 10));
		const requests =
			event.requestCount === undefined
				? 1
				: Math.max(0, numberOrZero(event.requestCount));
		const inputTokens = numberOrZero(event.inputTokens);
		const outputTokens = numberOrZero(event.outputTokens);
		const tokens = inputTokens + outputTokens;
		bucket.requests += requests;
		bucket.inputTokens += inputTokens;
		bucket.outputTokens += outputTokens;
		bucket.agentSeconds += numberOrZero(event.agentSeconds);
		addErrors(bucket, event, requests);
		addLatency(bucket, event);
		if (event.memberId) {
			bucket.memberIds.add(event.memberId);
		}
		if (event.nodeId) {
			bucket.nodeIds.add(event.nodeId);
		}
		addSpend(bucket, event);
		addBreakdown(
			byProvider,
			cleanKey(event.provider, "Unknown provider"),
			event,
			requests,
			tokens
		);
		addBreakdown(
			byModel,
			cleanKey(event.model, "Unknown model"),
			event,
			requests,
			tokens
		);
		addBreakdown(
			bySource,
			cleanKey(event.source, "unknown"),
			event,
			requests,
			tokens
		);
		addBreakdown(
			byFeature,
			cleanKey(event.feature, "Unattributed"),
			event,
			requests,
			tokens
		);
	}

	const materializedBuckets = [...buckets.entries()].map(([start, value]) => ({
		averageLatencyMs:
			value.latencySamples > 0
				? Math.round(value.latencyMs / value.latencySamples)
				: null,
		end: value.end.toISOString(),
		errors: value.errors,
		inputTokens: value.inputTokens,
		label: labelForKey(start, granularity),
		outputTokens: value.outputTokens,
		requests: value.requests,
		spendMicroUsd: value.knownSpend ? value.spendMicroUsd : null,
		start,
	}));
	const activeMemberIds = new Set<string>();
	const activeNodeIds = new Set<string>();
	const totals = materializedBuckets.reduce<UsageAnalyticsTotals>(
		(acc, bucket) => {
			acc.inputTokens += bucket.inputTokens;
			acc.outputTokens += bucket.outputTokens;
			acc.requests += bucket.requests;
			acc.errors += bucket.errors;
			if (bucket.spendMicroUsd !== null) {
				acc.spendMicroUsd = (acc.spendMicroUsd ?? 0) + bucket.spendMicroUsd;
			}
			return acc;
		},
		{
			activeDays: activeDateKeys.size,
			activeMembers: 0,
			activeNodes: 0,
			agentSeconds: 0,
			averageLatencyMs: null,
			errors: 0,
			inputTokens: 0,
			outputTokens: 0,
			requests: 0,
			spendMicroUsd: null,
		}
	);
	let latencyTotal = 0;
	let latencySamples = 0;
	for (const value of buckets.values()) {
		if (value.requests > 0 || value.inputTokens + value.outputTokens > 0) {
			for (const memberId of value.memberIds) {
				activeMemberIds.add(memberId);
			}
			for (const nodeId of value.nodeIds) {
				activeNodeIds.add(nodeId);
			}
		}
		if (value.latencySamples > 0) {
			latencyTotal += value.latencyMs;
			latencySamples += value.latencySamples;
		}
		totals.agentSeconds += value.agentSeconds;
	}
	totals.activeMembers = activeMemberIds.size;
	totals.activeNodes = activeNodeIds.size;
	totals.averageLatencyMs =
		latencySamples > 0 ? Math.round(latencyTotal / latencySamples) : null;

	return {
		availability: { supported: true },
		byFeature: toRows(byFeature),
		byModel: toRows(byModel),
		byProvider: toRows(byProvider),
		bySource: toRows(bySource, SOURCE_LABELS),
		buckets: materializedBuckets,
		caption,
		from: from.toISOString(),
		granularity,
		modelOptions: [...byModel.keys()].sort(),
		providerOptions: [...byProvider.keys()].sort(),
		scope,
		scopeLabel,
		to: to.toISOString(),
		totals,
	};
}
