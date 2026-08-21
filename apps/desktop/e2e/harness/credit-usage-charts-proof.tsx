import {
	type UsageRow,
	type UsageSummaryData,
	UsageView,
} from "@ryu/blocks/desktop/usage.tsx";
import {
	aggregateUsageEvents,
	type UsageDateRange,
	type UsageEvent,
	type UsageGranularity,
	type UsageScope,
} from "@ryu/blocks/desktop/usage-analytics.ts";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

const summary: UsageSummaryData = {
	byModel: [
		{ amountMicroUsd: 4_200_000, count: 19, key: "claude-sonnet-4" },
		{ amountMicroUsd: 1_450_000, count: 8, key: "gpt-4.1-mini" },
		{ amountMicroUsd: 600_000, count: 3, key: null },
	],
	byProvider: [
		{ amountMicroUsd: 4_200_000, count: 19, key: "Anthropic" },
		{ amountMicroUsd: 1_450_000, count: 8, key: "OpenAI" },
		{ amountMicroUsd: 600_000, count: 3, key: null },
	],
	byReason: [
		{ amountMicroUsd: 5_050_000, count: 27, key: "gateway_usage" },
		{ amountMicroUsd: 1_200_000, count: 3, key: "composio" },
		// Credits are visible in the transaction list but never counted as spend.
		{ amountMicroUsd: 0, count: 1, key: "topup" },
	],
	creditedMicroUsd: 25_000_000,
	durationMs: 184_000,
	inputTokens: 182_400,
	outputTokens: 64_200,
	spentMicroUsd: 6_250_000,
	transactions: 31,
};

const rows: UsageRow[] = [
	{
		balanceAfter: 18_750_000,
		createdAtLabel: "Aug 17, 2026, 10:32 AM",
		delta: -420_000,
		durationMs: 8400,
		id: "usage-1",
		inputTokens: 18_240,
		isCredit: false,
		model: "claude-sonnet-4",
		outputTokens: 6420,
		provider: "Anthropic",
		reason: "gateway_usage",
		taskLabel: "Summarize release notes",
	},
	{
		balanceAfter: 19_170_000,
		createdAtLabel: "Aug 17, 2026, 10:12 AM",
		delta: -160_000,
		durationMs: 2100,
		id: "usage-2",
		inputTokens: 9800,
		isCredit: false,
		model: "gpt-4.1-mini",
		outputTokens: 2900,
		provider: "OpenAI",
		reason: "gateway_usage",
		taskLabel: null,
	},
	{
		balanceAfter: 19_330_000,
		createdAtLabel: "Aug 16, 2026, 4:05 PM",
		delta: 25_000_000,
		durationMs: null,
		id: "credit-1",
		inputTokens: null,
		isCredit: true,
		model: null,
		outputTokens: null,
		provider: null,
		reason: "topup",
		taskLabel: null,
	},
];

const analyticsEvents: UsageEvent[] = [
	{
		costMicroUsd: 310_000,
		durationMs: 820,
		feature: "Chat",
		inputTokens: 4200,
		memberId: "jiawei",
		model: "claude-sonnet-4",
		nodeId: "node-managed",
		organizationId: "org-acme",
		outputTokens: 1600,
		provider: "anthropic",
		source: "managed",
		timestamp: "2026-08-01T09:15:00.000Z",
	},
	{
		costMicroUsd: 185_000,
		durationMs: 610,
		feature: "Agents",
		inputTokens: 2700,
		memberId: "min",
		model: "gpt-4.1-mini",
		nodeId: "node-managed",
		organizationId: "org-acme",
		outputTokens: 900,
		provider: "openai-credits",
		source: "managed",
		timestamp: "2026-08-02T12:45:00.000Z",
	},
	{
		durationMs: 340,
		feature: "Chat",
		inputTokens: 5200,
		memberId: "jiawei",
		model: "llama-3.1-8b",
		nodeId: "node-local",
		organizationId: "org-acme",
		outputTokens: 2200,
		provider: "local",
		source: "local",
		timestamp: "2026-08-03T03:15:00.000Z",
	},
	{
		durationMs: 720,
		error: true,
		feature: "Tools",
		inputTokens: 1800,
		memberId: "min",
		model: "gpt-4.1-mini",
		nodeId: "node-local",
		organizationId: "org-acme",
		outputTokens: 0,
		provider: "openai",
		source: "byok",
		timestamp: "2026-08-04T16:30:00.000Z",
	},
	{
		durationMs: 1280,
		feature: "Agents",
		inputTokens: 7600,
		memberId: "jiawei",
		model: "qwen2.5-coder",
		nodeId: "node-self-hosted",
		organizationId: "org-acme",
		outputTokens: 3400,
		provider: "vllm",
		source: "self_hosted",
		timestamp: "2026-08-05T08:00:00.000Z",
	},
	{
		costMicroUsd: 420_000,
		durationMs: 920,
		feature: "Chat",
		inputTokens: 6400,
		memberId: "jiawei",
		model: "claude-sonnet-4",
		nodeId: "node-managed",
		organizationId: "org-acme",
		outputTokens: 2600,
		provider: "anthropic",
		source: "managed",
		timestamp: "2026-08-07T11:00:00.000Z",
	},
	{
		durationMs: 390,
		feature: "Chat",
		inputTokens: 4800,
		memberId: "min",
		model: "llama-3.1-8b",
		nodeId: "node-local",
		organizationId: "org-acme",
		outputTokens: 2000,
		provider: "local",
		source: "local",
		timestamp: "2026-08-09T05:45:00.000Z",
	},
	{
		durationMs: 840,
		feature: "Tools",
		inputTokens: 3200,
		memberId: "jiawei",
		model: "gpt-4.1-mini",
		nodeId: "node-local",
		organizationId: "org-acme",
		outputTokens: 1200,
		provider: "openai",
		source: "byok",
		timestamp: "2026-08-10T18:15:00.000Z",
	},
	{
		durationMs: 1450,
		feature: "Agents",
		inputTokens: 8900,
		memberId: "min",
		model: "qwen2.5-coder",
		nodeId: "node-self-hosted",
		organizationId: "org-acme",
		outputTokens: 3900,
		provider: "vllm",
		source: "self_hosted",
		timestamp: "2026-08-12T06:30:00.000Z",
	},
	{
		costMicroUsd: 275_000,
		durationMs: 680,
		feature: "Chat",
		inputTokens: 3900,
		memberId: "jiawei",
		model: "gpt-4.1-mini",
		nodeId: "node-managed",
		organizationId: "org-acme",
		outputTokens: 1500,
		provider: "openai-credits",
		source: "managed",
		timestamp: "2026-08-14T14:00:00.000Z",
	},
	{
		durationMs: 510,
		feature: "Chat",
		inputTokens: 3100,
		memberId: "jiawei",
		model: "llama-3.1-8b",
		nodeId: "node-local",
		organizationId: "org-acme",
		outputTokens: 1400,
		provider: "local",
		source: "local",
		timestamp: "2026-08-16T09:30:00.000Z",
	},
	{
		durationMs: 760,
		feature: "Tools",
		inputTokens: 2500,
		memberId: "min",
		model: "gpt-4.1-mini",
		nodeId: "node-local",
		organizationId: "org-acme",
		outputTokens: 1000,
		provider: "openai",
		source: "byok",
		timestamp: "2026-08-17T10:15:00.000Z",
	},
	{
		durationMs: 530,
		feature: "Chat",
		inputTokens: 2200,
		memberId: "external-user",
		model: "gemini-2.5-flash",
		nodeId: "node-other-org",
		organizationId: "org-other",
		outputTokens: 900,
		provider: "genai",
		source: "byok",
		timestamp: "2026-08-06T09:00:00.000Z",
	},
];

const providerOptions = [
	"anthropic",
	"genai",
	"local",
	"openai",
	"openai-credits",
	"vllm",
];
const modelOptions = [
	"claude-sonnet-4",
	"gemini-2.5-flash",
	"gpt-4.1-mini",
	"llama-3.1-8b",
	"qwen2.5-coder",
];

const proofRange: UsageDateRange = {
	from: new Date("2026-08-01T00:00:00.000Z"),
	to: new Date("2026-08-18T00:00:00.000Z"),
};

function eventsForScope(scope: UsageScope): UsageEvent[] {
	if (scope === "organization") {
		return analyticsEvents.filter(
			(event) => event.organizationId === "org-acme"
		);
	}
	if (scope === "node") {
		return analyticsEvents.filter((event) => event.nodeId === "node-local");
	}
	return analyticsEvents;
}

function CreditUsageChartsProof() {
	const [scope, setScope] = useState<UsageScope>("organization");
	const [granularity, setGranularity] = useState<UsageGranularity>("daily");
	const [range, setRange] = useState<UsageDateRange>(proofRange);
	const [provider, setProvider] = useState<string | null>(null);
	const [model, setModel] = useState<string | null>(null);
	const analytics = useMemo(() => {
		const filteredEvents = eventsForScope(scope).filter(
			(event) =>
				(!provider || event.provider === provider) &&
				(!model || event.model === model)
		);
		return aggregateUsageEvents({
			caption:
				scope === "you"
					? "Everything you’ve consumed, regardless of org or node."
					: scope === "organization"
						? "All members and nodes in the active organization."
						: "Only usage routed through the selected node.",
			events: filteredEvents,
			from: range.from,
			granularity,
			scope,
			scopeLabel:
				scope === "you"
					? "You"
					: scope === "organization"
						? "Organization"
						: "This node",
			to: range.to,
		});
	}, [granularity, model, provider, range, scope]);

	return (
		<main className="min-h-screen bg-background px-6 py-10 text-foreground">
			<div className="mx-auto flex max-w-5xl flex-col gap-6">
				<header className="flex flex-col gap-2">
					<p className="font-medium text-primary text-xs uppercase tracking-[0.18em]">
						Ryu desktop verification artifact
					</p>
					<h1 className="font-semibold text-3xl tracking-tight">
						Usage analytics
					</h1>
					<p className="text-muted-foreground">
						Explore requests, tokens, latency, errors, providers, models, and
						non-credit traffic alongside the credit ledger.
					</p>
				</header>

				<UsageView
					analyticsDashboard={{
						analytics,
						granularity,
						loading: false,
						model,
						modelOptions,
						onGranularityChange: setGranularity,
						onModelChange: setModel,
						onProviderChange: setProvider,
						onRangeChange: setRange,
						onScopeChange: setScope,
						provider,
						providerOptions,
						range,
						scope,
					}}
					hasMore={false}
					loading={false}
					loadingMore={false}
					onLoadMore={() => undefined}
					onRefresh={() => undefined}
					rows={rows}
					summary={summary}
				/>

				<p className="text-muted-foreground text-xs" data-testid="proof-status">
					Verified presentation: scoped analytics, provider/model filters, date
					range + granularity controls, diverse shadcn charts, and the credit
					transaction list are visible together.
				</p>
			</div>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<CreditUsageChartsProof />);
}
