import {
	AlertCircleIcon,
	ArrowDown01Icon,
	ArrowRight01Icon,
	Clock01Icon,
	Refresh01Icon,
	Search01Icon,
	Tick02Icon,
	ZapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@ryu/ui/components/badge";
import { Button } from "@ryu/ui/components/button";
import { Input } from "@ryu/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@ryu/ui/components/native-select";
import { Textarea } from "@ryu/ui/components/textarea";
import { cn } from "@ryu/ui/lib/utils";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	SettingsCard,
	SettingsSection,
} from "@/src/components/settings/shared/settings-items.tsx";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	type AuditEntry,
	fetchGatewayAudit,
	pruneGatewayAudit,
	type RedTeamRunResult,
	runGatewayRedTeam,
	scoreGatewayOutput,
} from "@/src/lib/api/gateway.ts";
import {
	createPromptSuite,
	importPromptTrace,
	listPromptSuites,
} from "@/src/lib/api/prompt-suites.ts";
import { fetchRunTrace, type RunSpan } from "@/src/lib/api/runs.ts";
import { formatTime } from "@/src/lib/timezone.ts";

type ObservabilityFilter = "all" | "errors" | "slow" | "model" | "tool";
type ObservabilityWindow = "1h" | "24h" | "7d" | "all";

const REFRESH_INTERVAL_MS = 15_000;
const SLOW_REQUEST_MS = 1000;

function windowStart(value: ObservabilityWindow): string | undefined {
	const durationMs = {
		"1h": 60 * 60 * 1000,
		"24h": 24 * 60 * 60 * 1000,
		"7d": 7 * 24 * 60 * 60 * 1000,
		all: 0,
	}[value];
	return durationMs === 0
		? undefined
		: new Date(Date.now() - durationMs).toISOString();
}

function windowLabel(value: ObservabilityWindow): string {
	return {
		"1h": "Last hour",
		"24h": "Last 24 hours",
		"7d": "Last 7 days",
		all: "All available",
	}[value];
}

export interface ObservabilitySummary {
	averageLatencyMs: number | null;
	costMicroUsd: number;
	errorCount: number;
	qualityScore: number | null;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalRequests: number;
}

/** Keep the dashboard's aggregate math deterministic and independently testable. */
export function summarizeAudit(entries: AuditEntry[]): ObservabilitySummary {
	const latencyValues = entries.flatMap((entry) =>
		entry.latency_ms !== null && entry.latency_ms >= 0 ? [entry.latency_ms] : []
	);
	const qualityValues = entries.flatMap((entry) =>
		entry.eval_score !== null && Number.isFinite(entry.eval_score)
			? [entry.eval_score]
			: []
	);
	return {
		averageLatencyMs:
			latencyValues.length > 0
				? latencyValues.reduce((sum, value) => sum + value, 0) /
					latencyValues.length
				: null,
		costMicroUsd: entries.reduce(
			(sum, entry) => sum + (entry.cost_micro_usd ?? 0),
			0
		),
		errorCount: entries.filter((entry) => Boolean(entry.error)).length,
		qualityScore:
			qualityValues.length > 0
				? qualityValues.reduce((sum, value) => sum + value, 0) /
					qualityValues.length
				: null,
		totalInputTokens: entries.reduce(
			(sum, entry) => sum + (entry.input_tokens ?? 0),
			0
		),
		totalOutputTokens: entries.reduce(
			(sum, entry) => sum + (entry.output_tokens ?? 0),
			0
		),
		totalRequests: entries.length,
	};
}

/** Filter only at the presentation boundary; the server remains the ACL owner. */
export function filterAuditEntries(
	entries: AuditEntry[],
	query: string,
	filter: ObservabilityFilter
): AuditEntry[] {
	const needle = query.trim().toLowerCase();
	return entries.filter((entry) => {
		if (filter === "errors" && !entry.error) {
			return false;
		}
		if (filter === "slow" && (entry.latency_ms ?? 0) < SLOW_REQUEST_MS) {
			return false;
		}
		if (filter === "model" && entry.event_type !== "model_call") {
			return false;
		}
		if (filter === "tool" && entry.event_type !== "exec_call") {
			return false;
		}
		if (!needle) {
			return true;
		}
		return [
			entry.command,
			entry.error,
			entry.feature,
			entry.model,
			entry.provider,
			entry.request_id,
			entry.session_id,
		]
			.filter((value): value is string => Boolean(value))
			.some((value) => value.toLowerCase().includes(needle));
	});
}

function formatNumber(value: number): string {
	return new Intl.NumberFormat().format(value);
}

function formatCost(microUsd: number): string {
	if (microUsd === 0) {
		return "$0.00";
	}
	return `$${(microUsd / 1_000_000).toFixed(4)}`;
}

function formatScore(value: number | null): string {
	return value === null ? "—" : `${Math.round(value * 100)}%`;
}

interface SavedObservabilityView {
	filter: ObservabilityFilter;
	id: string;
	name: string;
	query: string;
	timeRange: ObservabilityWindow;
}

interface DiscoverGroup {
	averageLatency: number | null;
	count: number;
	errorCount: number;
	key: string;
	percent: number;
}

function discoverGroups(entries: AuditEntry[]): DiscoverGroup[] {
	const groups = new Map<string, AuditEntry[]>();
	for (const entry of entries) {
		const key = entry.error
			? `error · ${entry.error.slice(0, 72)}`
			: `${entry.provider} · ${entry.model}`;
		const group = groups.get(key) ?? [];
		group.push(entry);
		groups.set(key, group);
	}
	return Array.from(groups.entries())
		.map(([key, group]) => {
			const latency = group
				.map((entry) => entry.latency_ms)
				.filter((value): value is number => value !== null);
			return {
				averageLatency:
					latency.length > 0
						? latency.reduce((sum, value) => sum + value, 0) / latency.length
						: null,
				count: group.length,
				errorCount: group.filter((entry) => Boolean(entry.error)).length,
				key,
				percent: entries.length > 0 ? group.length / entries.length : 0,
			};
		})
		.sort((left, right) => right.count - left.count)
		.slice(0, 8);
}

function savedViewsKey(agentId: string): string {
	return `ryu-observability-views:${agentId}`;
}

function spanDuration(span: RunSpan): string {
	if (span.endedAt === null) {
		return "in flight";
	}
	const duration = Math.max(0, span.endedAt - span.startedAt);
	return duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`;
}

function SummaryCard({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: string;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-muted/20 p-3">
			<span className="text-[10px] text-muted-foreground uppercase tracking-wide">
				{label}
			</span>
			<span className={cn("font-medium text-base tabular-nums", tone)}>
				{value}
			</span>
		</div>
	);
}

function TraceRow({ span }: { span: RunSpan }) {
	const failed = Boolean(span.error);
	const model = span.kind === "model-call";
	return (
		<div className="flex items-start gap-3 border-t px-3 py-2.5 text-xs first:border-t-0">
			<div
				className={cn(
					"mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
					failed
						? "bg-destructive/10 text-status-destructive"
						: model
							? "bg-info/10 text-status-info"
							: "bg-warning/10 text-status-warning"
				)}
			>
				<HugeiconsIcon
					className="size-3.5"
					icon={model ? ZapIcon : Clock01Icon}
				/>
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-medium">{span.name}</span>
					<Badge className="px-1.5 py-0 text-[10px]" variant="outline">
						{span.kind}
					</Badge>
					<span className="text-muted-foreground">{spanDuration(span)}</span>
				</div>
				<p className="mt-1 text-muted-foreground">
					{failed
						? span.error
						: span.argsHash
							? `tool input fingerprint ${span.argsHash.slice(0, 12)}…`
							: "Completed without a persisted payload"}
				</p>
			</div>
			{failed ? (
				<HugeiconsIcon
					className="mt-1 size-3.5 shrink-0 text-status-destructive"
					icon={AlertCircleIcon}
				/>
			) : (
				<HugeiconsIcon
					className="mt-1 size-3.5 shrink-0 text-status-success"
					icon={Tick02Icon}
				/>
			)}
		</div>
	);
}

export interface AgentObservabilityViewProps {
	agentId: string;
	defaultModel?: string;
	onOpenRun?: (conversationId: string) => void;
	target: ApiTarget;
}

export function AgentObservabilityView({
	agentId,
	defaultModel,
	onOpenRun,
	target,
}: AgentObservabilityViewProps) {
	const [entries, setEntries] = useState<AuditEntry[]>([]);
	const [reachable, setReachable] = useState<boolean | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<ObservabilityFilter>("all");
	const [timeRange, setTimeRange] = useState<ObservabilityWindow>("24h");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [trace, setTrace] = useState<RunSpan[]>([]);
	const [traceLoading, setTraceLoading] = useState(false);
	const [traceError, setTraceError] = useState<string | null>(null);
	const [importing, setImporting] = useState(false);
	const [importMessage, setImportMessage] = useState<string | null>(null);
	const [importError, setImportError] = useState<string | null>(null);
	const [securityRunning, setSecurityRunning] = useState(false);
	const [securityResult, setSecurityResult] = useState<RedTeamRunResult | null>(
		null
	);
	const [securityError, setSecurityError] = useState<string | null>(null);
	const [savedViews, setSavedViews] = useState<SavedObservabilityView[]>([]);
	const [viewName, setViewName] = useState("");
	const [pruning, setPruning] = useState(false);
	const [pruneMessage, setPruneMessage] = useState<string | null>(null);
	const [scoreResponse, setScoreResponse] = useState("");
	const [scoreRubric, setScoreRubric] = useState("");
	const [scoring, setScoring] = useState(false);
	const [scoreResult, setScoreResult] = useState<number | null>(null);
	const [scoreError, setScoreError] = useState<string | null>(null);

	const load = useCallback(
		async (signal?: AbortSignal) => {
			setLoading(true);
			try {
				const response = await fetchGatewayAudit(
					target,
					{ agentId, from: windowStart(timeRange), limit: 100 },
					signal
				);
				if (!signal?.aborted) {
					setEntries(response.entries);
					setReachable(response.reachable);
					setError(null);
				}
			} catch (cause) {
				if (!signal?.aborted) {
					setError(
						cause instanceof Error
							? cause.message
							: "Failed to load observability"
					);
				}
			} finally {
				if (!signal?.aborted) {
					setLoading(false);
				}
			}
		},
		[agentId, target, timeRange]
	);

	useEffect(() => {
		const controller = new AbortController();
		load(controller.signal).catch(() => undefined);
		const timer = window.setInterval(() => {
			load().catch(() => undefined);
		}, REFRESH_INTERVAL_MS);
		return () => {
			controller.abort();
			window.clearInterval(timer);
		};
	}, [load]);

	const visibleEntries = useMemo(
		() => filterAuditEntries(entries, query, filter),
		[entries, filter, query]
	);
	const summary = useMemo(() => summarizeAudit(entries), [entries]);
	const discoveredGroups = useMemo(() => discoverGroups(entries), [entries]);
	const selected = entries.find((entry) => entry.id === selectedId) ?? null;
	const selectedRunId = selected?.session_id ?? null;

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		try {
			const raw = window.localStorage.getItem(savedViewsKey(agentId));
			if (!raw) {
				setSavedViews([]);
				return;
			}
			const parsed: unknown = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				setSavedViews([]);
				return;
			}
			setSavedViews(
				parsed.filter((value): value is SavedObservabilityView => {
					if (!value || typeof value !== "object") {
						return false;
					}
					const view = value as Partial<SavedObservabilityView>;
					return (
						typeof view.id === "string" &&
						typeof view.name === "string" &&
						typeof view.query === "string" &&
						["all", "errors", "slow", "model", "tool"].includes(
							view.filter ?? ""
						) &&
						["1h", "24h", "7d", "all"].includes(view.timeRange ?? "")
					);
				})
			);
		} catch {
			setSavedViews([]);
		}
	}, [agentId]);

	const saveView = useCallback(() => {
		const name = viewName.trim();
		if (!name || typeof window === "undefined") {
			return;
		}
		const next = [
			{
				filter,
				id: crypto.randomUUID(),
				name,
				query,
				timeRange,
			},
			...savedViews,
		].slice(0, 12);
		setSavedViews(next);
		setViewName("");
		window.localStorage.setItem(savedViewsKey(agentId), JSON.stringify(next));
	}, [agentId, filter, query, savedViews, timeRange, viewName]);

	const deleteView = useCallback(
		(id: string) => {
			const next = savedViews.filter((view) => view.id !== id);
			setSavedViews(next);
			window.localStorage.setItem(savedViewsKey(agentId), JSON.stringify(next));
		},
		[agentId, savedViews]
	);

	const pruneAudit = useCallback(async () => {
		setPruning(true);
		setPruneMessage(null);
		try {
			const result = await pruneGatewayAudit(target);
			setPruneMessage(
				`Retention applied · ${result.deleted_rows ?? 0} rows removed`
			);
			await load();
		} catch (cause) {
			setPruneMessage(
				cause instanceof Error ? cause.message : "Retention pass failed"
			);
		} finally {
			setPruning(false);
		}
	}, [load, target]);

	const scoreOnline = useCallback(async () => {
		if (!scoreResponse.trim()) {
			return;
		}
		setScoring(true);
		setScoreError(null);
		try {
			const result = await scoreGatewayOutput(target, {
				agent_id: agentId,
				assertions: scoreRubric.trim()
					? [{ kind: "llm_rubric", rubric: scoreRubric.trim() }]
					: [],
				model: selected?.model ?? defaultModel,
				prompt: selected?.request_id ?? "observability trace",
				response: scoreResponse,
			});
			setScoreResult(result.score.overall);
		} catch (cause) {
			setScoreError(
				cause instanceof Error ? cause.message : "Online scoring failed"
			);
		} finally {
			setScoring(false);
		}
	}, [agentId, defaultModel, scoreResponse, scoreRubric, selected, target]);
	useEffect(() => {
		if (!selected?.session_id) {
			setTrace([]);
			setTraceError(null);
			return;
		}
		const controller = new AbortController();
		setTraceLoading(true);
		setTraceError(null);
		setImportMessage(null);
		setImportError(null);
		fetchRunTrace(target, selected.session_id, controller.signal)
			.then((spans) => setTrace(spans))
			.catch((cause) => {
				if (!controller.signal.aborted) {
					setTraceError(
						cause instanceof Error ? cause.message : "Failed to load trace"
					);
				}
			})
			.finally(() => {
				if (!controller.signal.aborted) {
					setTraceLoading(false);
				}
			});
		return () => controller.abort();
	}, [selected?.session_id, target]);

	const importSelectedTrace = useCallback(async () => {
		if (!selectedRunId) {
			return;
		}
		setImporting(true);
		setImportMessage(null);
		setImportError(null);
		try {
			const suites = await listPromptSuites(target, agentId);
			const suite =
				suites[0] ??
				(
					await createPromptSuite(target, {
						agentId,
						config: {
							prompts: [],
							providers: selected?.model ? [selected.model] : [],
							tests: [],
						},
						label: "Trace baseline",
						name: "Agent regression suite",
					})
				).suite;
			const result = await importPromptTrace(target, suite.id, selectedRunId);
			setImportMessage(
				result.added
					? `Added to ${result.suite.name} as a versioned test case.`
					: `This trace is already in ${result.suite.name}.`
			);
		} catch (cause) {
			setImportError(
				cause instanceof Error
					? cause.message
					: "Failed to add trace to Quality tests"
			);
		} finally {
			setImporting(false);
		}
	}, [agentId, selected?.model, selectedRunId, target]);

	const runSecuritySweep = useCallback(async () => {
		setSecurityRunning(true);
		setSecurityError(null);
		try {
			const result = await runGatewayRedTeam(target, {
				agent_id: agentId,
				model: defaultModel?.trim() || "gpt-4o-mini",
			});
			setSecurityResult(result);
		} catch (cause) {
			setSecurityError(
				cause instanceof Error ? cause.message : "Security sweep failed"
			);
		} finally {
			setSecurityRunning(false);
		}
	}, [agentId, defaultModel, target]);

	return (
		<div
			className="mx-auto flex w-full max-w-5xl flex-col gap-6"
			data-testid="agent-observability"
		>
			<SettingsSection
				caption="Trace production behavior, inspect correlated spans, and turn evidence into the next quality test."
				headerAction={
					<Badge
						className="gap-1"
						variant={error || reachable === false ? "destructive" : "outline"}
					>
						<span
							className={cn(
								"size-1.5 rounded-full",
								error || reachable === false
									? "bg-destructive-foreground"
									: "bg-success"
							)}
						/>
						{error || reachable === false ? "Unavailable" : "Live · 15s"}
					</Badge>
				}
				title="Agent observability"
			>
				<SettingsCard className="flex flex-col gap-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<p className="font-medium text-sm">Production signal</p>
							<p className="mt-1 text-muted-foreground text-xs">
								Gateway audit and Core traces stay on this node unless you opt
								into export.
							</p>
						</div>
						<Button
							aria-label="Refresh observability"
							loading={loading}
							onClick={() => load().catch(() => undefined)}
							size="icon-sm"
							variant="ghost"
						>
							<HugeiconsIcon className="size-3.5" icon={Refresh01Icon} />
						</Button>
						<Button
							disabled={pruning || reachable === false}
							loading={pruning}
							onClick={() => pruneAudit().catch(() => undefined)}
							size="sm"
							variant="ghost"
						>
							Prune local audit
						</Button>
					</div>
					{pruneMessage ? (
						<p className="text-muted-foreground text-xs" role="status">
							{pruneMessage}
						</p>
					) : null}

					{error ? (
						<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-status-destructive text-xs">
							{error}
						</div>
					) : reachable === false ? (
						<div className="rounded-lg border border-dashed p-4 text-muted-foreground text-xs">
							Gateway audit is unavailable. The node is still running, but no
							remote model-call evidence is available until the Gateway or audit
							store returns.
						</div>
					) : null}

					<div
						className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
						data-testid="observability-summary"
					>
						<SummaryCard
							label="Requests"
							value={formatNumber(summary.totalRequests)}
						/>
						<SummaryCard
							label="Errors"
							tone={
								summary.errorCount > 0
									? "text-status-destructive"
									: "text-status-success"
							}
							value={formatNumber(summary.errorCount)}
						/>
						<SummaryCard
							label="Avg latency"
							value={
								summary.averageLatencyMs === null
									? "—"
									: `${Math.round(summary.averageLatencyMs)}ms`
							}
						/>
						<SummaryCard
							label="Quality"
							value={formatScore(summary.qualityScore)}
						/>
						<SummaryCard
							label="Tokens"
							value={formatNumber(
								summary.totalInputTokens + summary.totalOutputTokens
							)}
						/>
						<SummaryCard
							label="Spend"
							value={formatCost(summary.costMicroUsd)}
						/>
						<SummaryCard label="Window" value={windowLabel(timeRange)} />
					</div>
				</SettingsCard>
			</SettingsSection>

			<SettingsSection
				caption="Search model calls, errors, slow requests, and execution events. Select a row to inspect its correlated trace."
				title="Trace explorer"
			>
				<SettingsCard className="flex flex-col gap-3">
					<div className="flex flex-col gap-2 sm:flex-row">
						<div className="relative min-w-0 flex-1">
							<HugeiconsIcon
								className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
								icon={Search01Icon}
							/>
							<Input
								aria-label="Search observability"
								className="!text-[var(--foreground)] pl-8"
								data-testid="observability-search"
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search model, provider, request id, or error"
								style={{
									WebkitTextFillColor: "var(--foreground)",
									color: "var(--foreground)",
								}}
								value={query}
							/>
						</div>
						<div className="flex w-full gap-2 sm:w-auto">
							<NativeSelect
								aria-label="Observability filter"
								className="[&_select]:!text-[var(--foreground)] min-w-0 flex-1 sm:w-40"
								onChange={(event) =>
									setFilter(event.target.value as ObservabilityFilter)
								}
								style={{ color: "var(--foreground)" }}
								value={filter}
							>
								<NativeSelectOption value="all">All events</NativeSelectOption>
								<NativeSelectOption value="errors">
									Errors only
								</NativeSelectOption>
								<NativeSelectOption value="slow">
									Slow &gt; 1s
								</NativeSelectOption>
								<NativeSelectOption value="model">
									Model calls
								</NativeSelectOption>
								<NativeSelectOption value="tool">Tool calls</NativeSelectOption>
							</NativeSelect>
							<NativeSelect
								aria-label="Observability window"
								className="[&_select]:!text-[var(--foreground)] min-w-0 flex-1 sm:w-40"
								onChange={(event) =>
									setTimeRange(event.target.value as ObservabilityWindow)
								}
								style={{ color: "var(--foreground)" }}
								value={timeRange}
							>
								<NativeSelectOption value="1h">Last hour</NativeSelectOption>
								<NativeSelectOption value="24h">
									Last 24 hours
								</NativeSelectOption>
								<NativeSelectOption value="7d">Last 7 days</NativeSelectOption>
								<NativeSelectOption value="all">
									All available
								</NativeSelectOption>
							</NativeSelect>
						</div>
					</div>

					{visibleEntries.length === 0 ? (
						<div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-xs">
							{loading ? "Loading trace events…" : "No events match this view."}
						</div>
					) : (
						<div
							className="overflow-hidden rounded-lg border"
							data-testid="observability-events"
						>
							<div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 bg-muted/50 px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wide">
								<span>Event</span>
								<span>Latency</span>
								<span>Quality</span>
								<span>Cost</span>
							</div>
							{visibleEntries.map((entry) => {
								const active = selectedId === entry.id;
								return (
									<button
										className={cn(
											"grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-t px-3 py-2.5 text-left text-xs transition-colors",
											"!text-[var(--foreground)]",
											"hover:bg-muted/40",
											active && "bg-primary/5"
										)}
										data-testid={`observability-event-${entry.id}`}
										key={entry.id}
										onClick={() => setSelectedId(entry.id)}
										style={{
											WebkitTextFillColor: "var(--foreground)",
											color: "var(--foreground)",
										}}
										type="button"
									>
										<span className="flex min-w-0 items-center gap-2">
											<span
												className={cn(
													"size-1.5 shrink-0 rounded-full",
													entry.error ? "bg-destructive" : "bg-success"
												)}
											/>
											<span className="min-w-0 truncate font-medium">
												{entry.model ??
													entry.command ??
													entry.event_type ??
													"event"}
											</span>
											<Badge
												className="hidden px-1.5 py-0 text-[10px] sm:inline-flex"
												variant="outline"
											>
												{entry.provider ?? entry.event_type ?? "event"}
											</Badge>
											<span className="hidden text-muted-foreground md:inline">
												{formatTime(entry.timestamp)}
											</span>
										</span>
										<span className="whitespace-nowrap text-muted-foreground">
											{entry.latency_ms === null
												? "—"
												: `${entry.latency_ms}ms`}
										</span>
										<span>{formatScore(entry.eval_score)}</span>
										<span className="whitespace-nowrap text-muted-foreground">
											{formatCost(entry.cost_micro_usd ?? 0)}
										</span>
									</button>
								);
							})}
						</div>
					)}
				</SettingsCard>
			</SettingsSection>

			<SettingsSection
				caption="Group production evidence into failure patterns and model/provider facets. Saved views stay local to this agent on this device."
				title="Discover"
			>
				<SettingsCard
					className="flex flex-col gap-3"
					data-testid="observability-discover"
				>
					<div className="flex flex-col gap-2 sm:flex-row">
						<Input
							aria-label="Saved observability view name"
							className="h-8 min-w-0 flex-1"
							onChange={(event) => setViewName(event.target.value)}
							placeholder="Name this view, e.g. Checkout failures"
							value={viewName}
						/>
						<Button disabled={!viewName.trim()} onClick={saveView} size="sm">
							Save current view
						</Button>
					</div>
					{savedViews.length > 0 ? (
						<div className="flex flex-wrap gap-1.5">
							{savedViews.map((view) => (
								<div className="flex items-center gap-0.5" key={view.id}>
									<Button
										className="h-7 text-xs"
										onClick={() => {
											setFilter(view.filter);
											setQuery(view.query);
											setTimeRange(view.timeRange);
										}}
										size="sm"
										variant="outline"
									>
										{view.name}
									</Button>
									<Button
										aria-label={`Remove saved view ${view.name}`}
										className="size-7"
										onClick={() => deleteView(view.id)}
										size="icon-sm"
										variant="ghost"
									>
										×
									</Button>
								</div>
							))}
						</div>
					) : null}
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-2">
							<span className="font-medium text-xs">Top patterns</span>
							<span className="text-[10px] text-muted-foreground">
								{entries.length} events in{" "}
								{windowLabel(timeRange).toLowerCase()}
							</span>
						</div>
						{discoveredGroups.length === 0 ? (
							<p className="rounded-lg border border-dashed p-4 text-center text-muted-foreground text-xs">
								No patterns to discover yet.
							</p>
						) : (
							<div className="flex flex-col gap-2">
								{discoveredGroups.map((group) => (
									<div className="flex flex-col gap-1" key={group.key}>
										<div className="flex items-center justify-between gap-2 text-xs">
											<span className="min-w-0 truncate font-medium">
												{group.key}
											</span>
											<span className="shrink-0 text-muted-foreground">
												{group.count} · {Math.round(group.percent * 100)}%
											</span>
										</div>
										<div className="h-2 overflow-hidden rounded-full bg-muted">
											<div
												className={cn(
													"h-full rounded-full",
													group.errorCount > 0 ? "bg-destructive" : "bg-primary"
												)}
												style={{
													width: `${Math.max(4, group.percent * 100)}%`,
												}}
											/>
										</div>
										<div className="flex gap-2 text-[10px] text-muted-foreground">
											<span>{group.errorCount} errors</span>
											<span>
												avg{" "}
												{group.averageLatency === null
													? "—"
													: `${Math.round(group.averageLatency)}ms`}
											</span>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				</SettingsCard>
			</SettingsSection>

			{selected ? (
				<SettingsSection
					caption="Core keeps tool input fingerprints instead of raw arguments in the local trace store. Open the conversation for the full transcript."
					title="Selected trace"
				>
					<div data-testid="observability-trace">
						<SettingsCard className="flex flex-col gap-3">
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<h3 className="font-medium text-sm">
											{selected.model ?? selected.command ?? "Trace event"}
										</h3>
										{selected.error ? (
											<Badge variant="destructive">Failed</Badge>
										) : (
											<Badge variant="secondary">Completed</Badge>
										)}
									</div>
									<p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
										{selected.session_id ?? selected.request_id}
									</p>
								</div>
								<div className="text-right text-xs">
									<p className="font-medium">
										{formatNumber(
											(selected.input_tokens ?? 0) +
												(selected.output_tokens ?? 0)
										)}{" "}
										tokens
									</p>
									<p className="text-muted-foreground">
										{formatCost(selected.cost_micro_usd ?? 0)}
									</p>
								</div>
								<div className="flex flex-wrap justify-end gap-2">
									{selectedRunId ? (
										<Button
											disabled={importing}
											loading={importing}
											onClick={() =>
												importSelectedTrace().catch(() => undefined)
											}
											size="sm"
											variant="outline"
										>
											Add to Quality tests
										</Button>
									) : null}
									{selectedRunId && onOpenRun ? (
										<Button
											onClick={() => onOpenRun(selectedRunId)}
											size="sm"
											variant="outline"
										>
											Open conversation
										</Button>
									) : null}
								</div>
							</div>

							{selected.error ? (
								<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-status-destructive text-xs">
									{selected.error}
								</div>
							) : null}
							{importMessage ? (
								<p className="text-status-success text-xs" role="status">
									{importMessage}
								</p>
							) : null}
							{importError ? (
								<p className="text-status-destructive text-xs" role="alert">
									{importError}
								</p>
							) : null}

							{selected.session_id ? (
								<div className="overflow-hidden rounded-lg border">
									<div className="flex items-center gap-2 bg-muted/40 px-3 py-2 text-xs">
										<HugeiconsIcon
											className="size-3.5 text-muted-foreground"
											icon={ArrowDown01Icon}
										/>
										<span className="font-medium">Core run spans</span>
										<span className="text-muted-foreground">
											{trace.length} recorded
										</span>
									</div>
									{traceLoading ? (
										<p className="p-3 text-muted-foreground text-xs">
											Loading spans…
										</p>
									) : null}
									{traceError ? (
										<p className="p-3 text-status-destructive text-xs">
											{traceError}
										</p>
									) : null}
									{!(traceLoading || traceError) && trace.length === 0 ? (
										<p className="p-3 text-muted-foreground text-xs">
											No Core spans were recorded for this session.
										</p>
									) : null}
									{trace.map((span) => (
										<TraceRow key={span.id} span={span} />
									))}
								</div>
							) : (
								<div className="rounded-lg border border-dashed p-3 text-muted-foreground text-xs">
									This Gateway event has no Core session link, so a local span
									timeline is unavailable.
								</div>
							)}
						</SettingsCard>
						<SettingsCard className="flex flex-col gap-3">
							<div>
								<p className="font-medium text-sm">Online scoring</p>
								<p className="mt-1 text-muted-foreground text-xs">
									Score a completed output with Gateway without replaying its
									provider call.
								</p>
							</div>
							<Textarea
								aria-label="Completed output to score"
								className="min-h-20 font-mono text-xs"
								onChange={(event) => setScoreResponse(event.target.value)}
								placeholder="Paste the completed model output here…"
								value={scoreResponse}
							/>
							<Input
								aria-label="Online scoring rubric"
								className="h-8 text-xs"
								onChange={(event) => setScoreRubric(event.target.value)}
								placeholder="Optional rubric for an LLM judge"
								value={scoreRubric}
							/>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									disabled={!scoreResponse.trim()}
									loading={scoring}
									onClick={() => scoreOnline().catch(() => undefined)}
									size="sm"
									variant="outline"
								>
									Score output
								</Button>
								{scoreResult === null ? null : (
									<Badge variant="secondary">
										Online score {formatScore(scoreResult)}
									</Badge>
								)}
							</div>
							{scoreError ? (
								<p className="text-status-destructive text-xs" role="alert">
									{scoreError}
								</p>
							) : null}
						</SettingsCard>
					</div>
				</SettingsSection>
			) : null}

			<SettingsSection
				caption="Run a bounded local campaign for prompt injection, jailbreaks, PII leakage, tool misuse, and toxic output."
				title="Security sweep"
			>
				<SettingsCard
					className="flex flex-col gap-3"
					data-testid="observability-security"
				>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="min-w-0">
							<p className="font-medium text-sm">Agent safety probes</p>
							<p className="mt-1 max-w-2xl text-muted-foreground text-xs leading-relaxed">
								These fixed probes use the existing Gateway evaluator catalog
								and follow the same provider, policy, and metering path as
								production. No real tool is executed by the campaign.
							</p>
						</div>
						<Button
							data-testid="observability-security-run"
							loading={securityRunning}
							onClick={() => runSecuritySweep().catch(() => undefined)}
							size="sm"
							variant="outline"
						>
							Run security checks
						</Button>
					</div>

					{securityError ? (
						<p
							className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-status-destructive text-xs"
							role="alert"
						>
							{securityError}
						</p>
					) : null}

					{securityResult ? (
						<div
							className="flex flex-col gap-2"
							data-testid="observability-security-result"
						>
							<div className="flex flex-wrap items-center gap-2 text-xs">
								<Badge variant="secondary">
									{securityResult.summary.protected}/
									{securityResult.summary.total} protected
								</Badge>
								<Badge
									variant={
										securityResult.summary.needs_attention > 0
											? "destructive"
											: "outline"
									}
								>
									{securityResult.summary.needs_attention} needs attention
								</Badge>
								<span className="text-muted-foreground">
									{securityResult.model}
								</span>
							</div>
							<div className="overflow-hidden rounded-lg border">
								{securityResult.strategies.map((strategy) => (
									<div
										className="flex flex-wrap items-start justify-between gap-2 border-t px-3 py-2.5 text-xs first:border-t-0"
										key={strategy.id}
									>
										<div className="min-w-0">
											<p className="font-medium">{strategy.name}</p>
											<p className="mt-1 text-muted-foreground">
												{strategy.detail}
											</p>
										</div>
										<Badge
											variant={strategy.protected ? "secondary" : "destructive"}
										>
											{strategy.protected ? "Protected" : "Needs attention"}
										</Badge>
									</div>
								))}
							</div>
						</div>
					) : null}
				</SettingsCard>
			</SettingsSection>

			<SettingsCard className="flex flex-col gap-2 border-dashed bg-muted/10">
				<div className="flex items-center gap-2">
					<HugeiconsIcon
						className="size-4 text-status-info"
						icon={ArrowRight01Icon}
					/>
					<span className="font-medium text-sm">
						From signal to regression test
					</span>
				</div>
				<p className="text-muted-foreground text-xs leading-relaxed">
					Use the Quality tests tab to turn a failure or edge case into a
					versioned dataset, compare prompts and models, and score it with
					deterministic, LLM, code, or human review. This keeps production
					observation and offline evaluation connected without duplicating
					either contract.
				</p>
			</SettingsCard>
		</div>
	);
}
