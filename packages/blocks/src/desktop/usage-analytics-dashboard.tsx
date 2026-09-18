"use client";

import { Calendar03Icon, FilterIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert, AlertDescription } from "@ryu/ui/components/alert";
import { Badge } from "@ryu/ui/components/badge";
import { Button } from "@ryu/ui/components/button";
import { Calendar } from "@ryu/ui/components/calendar";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@ryu/ui/components/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@ryu/ui/components/chart";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ryu/ui/components/empty";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@ryu/ui/components/popover";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
} from "@ryu/ui/components/select";
import { Spinner } from "@ryu/ui/components/spinner";
import { ToggleGroup, ToggleGroupItem } from "@ryu/ui/components/toggle-group";
import { formatCount } from "@ryu/ui/lib/number-format.ts";
import { useId, useState } from "react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	// biome-ignore lint/suspicious/noDeprecatedImports: Recharts Pie still uses Cell for per-slice colors.
	Cell,
	Pie,
	PieChart,
	XAxis,
	YAxis,
} from "recharts";
import { formatMicroUsd } from "./credits.tsx";
import {
	compactUsageTrendPoints,
	GRANULARITY_LABELS,
	type UsageAnalyticsData,
	type UsageBreakdownRow,
	type UsageDateRange,
	type UsageGranularity,
	type UsageScope,
	type UsageTrendPoint,
} from "./usage-analytics.ts";

const SCOPE_LABELS: Record<UsageScope, string> = {
	node: "This node",
	organization: "Organization",
	you: "You",
};

const SCOPE_VALUES: UsageScope[] = ["you", "organization", "node"];
const GRANULARITY_VALUES: UsageGranularity[] = [
	"15m",
	"hourly",
	"daily",
	"weekly",
	"monthly",
];

const CHART_COLORS = [
	"#0099ff",
	"oklch(0.62 0.19 306)",
	"oklch(0.68 0.16 164)",
	"oklch(0.76 0.16 76)",
	"oklch(0.68 0.18 24)",
	"oklch(0.65 0.16 200)",
] as const;

const ANALYTICS_CARD_CLASS = "border border-border/60 bg-card/80 shadow-sm";

const KPI_COLORS = {
	"active days": "oklch(0.68 0.16 164)",
	"active members": "oklch(0.68 0.16 164)",
	"active nodes": "oklch(0.65 0.16 200)",
	"avg latency": "oklch(0.76 0.16 76)",
	"credit spend": "oklch(0.76 0.16 76)",
	errors: "oklch(0.68 0.18 24)",
	requests: "#0099ff",
	tokens: "oklch(0.62 0.19 306)",
} as const;

type TrendMetric = "requests" | "tokens" | "errors" | "spend";

const TREND_METRICS: readonly {
	color: string;
	key: TrendMetric;
	label: string;
}[] = [
	{ color: KPI_COLORS.requests, key: "requests", label: "Requests" },
	{ color: KPI_COLORS.tokens, key: "tokens", label: "Tokens" },
	{ color: KPI_COLORS.errors, key: "errors", label: "Errors" },
	{ color: KPI_COLORS["credit spend"], key: "spend", label: "Credit spend" },
];

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

function dateRangeLabel(range: UsageDateRange): string {
	const lastDay = new Date(range.to.getTime() - 1);
	const formatter = new Intl.DateTimeFormat(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
	return `${formatter.format(range.from)} – ${formatter.format(lastDay)}`;
}

function formatCompact(value: number): string {
	return formatCount(value) ?? "—";
}

function formatMilliseconds(value: number | null): string {
	return value === null ? "—" : `${formatCompact(value)} ms`;
}

function formatSpend(value: number | null): string {
	return value === null ? "Not billed" : formatMicroUsd(value);
}

function trendPointValue(point: UsageTrendPoint, metric: TrendMetric): number {
	return metric === "spend" ? (point.spend ?? 0) : point[metric];
}

function trendMetricTotal(
	data: UsageAnalyticsData,
	metric: TrendMetric
): number | null {
	switch (metric) {
		case "errors":
			return data.totals.errors;
		case "requests":
			return data.totals.requests;
		case "spend":
			return data.totals.spendMicroUsd;
		case "tokens":
			return data.totals.inputTokens + data.totals.outputTokens;
	}
}

function formatTrendValue(metric: TrendMetric, value: number): string {
	return metric === "spend" ? formatMicroUsd(value) : formatCompact(value);
}

function formatBreakdownValue(entry: UsageBreakdownRow): string {
	const requests = `${formatCompact(entry.requests)} req`;
	return entry.spendMicroUsd === null
		? requests
		: `${formatMicroUsd(entry.spendMicroUsd)} · ${requests}`;
}

function KpiCard({
	color,
	label,
	value,
	detail,
}: {
	color?: string;
	detail?: string;
	label: string;
	value: string;
}) {
	return (
		<Card
			className={`${ANALYTICS_CARD_CLASS} min-h-24`}
			data-testid={`usage-kpi-${label.toLowerCase().replaceAll(" ", "-")}`}
		>
			<CardHeader className="gap-2">
				<CardDescription className="flex items-center gap-2">
					<span
						aria-hidden="true"
						className="size-2 shrink-0 rounded-full"
						style={{ backgroundColor: color }}
					/>
					{label}
				</CardDescription>
				<CardTitle className="font-medium text-2xl tabular-nums">
					{value}
				</CardTitle>
			</CardHeader>
			{detail ? (
				<CardContent className="pt-0">
					<p className="text-muted-foreground text-xs">{detail}</p>
				</CardContent>
			) : null}
		</Card>
	);
}

function MetricTile({
	color,
	label,
	selected = false,
	value,
}: {
	color: string;
	label: string;
	selected?: boolean;
	value: string;
}) {
	return (
		<div
			className={`flex min-w-0 flex-col gap-1 rounded-2xl border border-border/50 bg-muted/35 px-3 py-2.5 ${selected ? "bg-primary/5 ring-1 ring-primary/25" : ""}`}
		>
			<div className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
				<span
					aria-hidden="true"
					className="size-2 shrink-0 rounded-full"
					style={{ backgroundColor: color }}
				/>
				<span className="truncate">{label}</span>
			</div>
			<span className="truncate font-medium text-sm tabular-nums">{value}</span>
		</div>
	);
}

function UsageTrend({ data }: { data: UsageAnalyticsData }) {
	const [selectedMetric, setSelectedMetric] = useState<TrendMetric>("requests");
	const gradientId = `usage-trend-fill-${useId().replace(/:/g, "")}`;
	const chartData = compactUsageTrendPoints(
		data.buckets.map((bucket) => ({
			errors: bucket.errors,
			label: bucket.label,
			requests: bucket.requests,
			spend: bucket.spendMicroUsd,
			tokens: bucket.inputTokens + bucket.outputTokens,
		}))
	);
	const metricDefinition =
		TREND_METRICS.find(({ key }) => key === selectedMetric) ?? TREND_METRICS[0];
	const config: ChartConfig = {
		[selectedMetric]: {
			color: metricDefinition.color,
			label: metricDefinition.label,
		},
	};
	const hasSelectedData = chartData.some(
		(point) => trendPointValue(point, selectedMetric) > 0
	);
	const selectedTotal = trendMetricTotal(data, selectedMetric);
	const metricTiles = [
		{
			color: KPI_COLORS.requests,
			key: "requests" as const,
			label: "Requests",
			value: formatCompact(data.totals.requests),
		},
		{
			color: KPI_COLORS.tokens,
			key: "tokens" as const,
			label: "Tokens",
			value: formatCompact(data.totals.inputTokens + data.totals.outputTokens),
		},
		{
			color: KPI_COLORS.errors,
			key: "errors" as const,
			label: "Errors",
			value: formatCompact(data.totals.errors),
		},
		{
			color: KPI_COLORS["credit spend"],
			key: "spend" as const,
			label: "Credit spend",
			value: formatSpend(data.totals.spendMicroUsd),
		},
	];

	return (
		<Card
			className={`${ANALYTICS_CARD_CLASS} min-w-0`}
			data-testid="usage-analytics-chart-trend"
		>
			<CardHeader className="gap-3">
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<CardTitle>Activity over time</CardTitle>
						<CardDescription>
							{metricDefinition.label} at{" "}
							{GRANULARITY_LABELS[data.granularity].toLowerCase()} resolution.
						</CardDescription>
					</div>
					<CardAction className="ml-auto shrink-0 text-right">
						<div
							className="font-medium text-xl tabular-nums"
							data-testid="usage-trend-selected"
						>
							{selectedTotal === null
								? "Not billed"
								: formatTrendValue(selectedMetric, selectedTotal)}
						</div>
						<div className="text-muted-foreground text-xs">
							{metricDefinition.label.toLowerCase()} in range
						</div>
					</CardAction>
				</div>
				<div
					className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-muted/35 p-1.5"
					data-testid="usage-trend-metric"
				>
					<span className="px-2 font-medium text-muted-foreground text-xs">
						Show
					</span>
					<ToggleGroup
						aria-label="Usage trend metric"
						className="bg-transparent"
						multiple={false}
						onValueChange={(values: string[]) => {
							const [value] = values;
							if (TREND_METRICS.some(({ key }) => key === value)) {
								setSelectedMetric(value as TrendMetric);
							}
						}}
						spacing={0}
						value={[selectedMetric]}
						variant="default"
					>
						{TREND_METRICS.map((metric) => (
							<ToggleGroupItem
								className="h-8 px-2.5 text-xs"
								key={metric.key}
								value={metric.key}
							>
								<span
									aria-hidden="true"
									className="mr-1.5 size-1.5 rounded-full"
									style={{ backgroundColor: metric.color }}
								/>
								{metric.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{hasSelectedData ? (
					<ChartContainer className="h-[280px] w-full" config={config}>
						<AreaChart
							accessibilityLayer
							data={chartData}
							margin={{ left: 4, right: 8, top: 8 }}
						>
							<defs>
								<linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
									<stop
										offset="5%"
										stopColor={`var(--color-${selectedMetric})`}
										stopOpacity={0.35}
									/>
									<stop
										offset="95%"
										stopColor={`var(--color-${selectedMetric})`}
										stopOpacity={0.02}
									/>
								</linearGradient>
							</defs>
							<CartesianGrid strokeOpacity={0.35} vertical={false} />
							<XAxis
								axisLine={false}
								dataKey="label"
								minTickGap={38}
								tickLine={false}
								tickMargin={8}
							/>
							<YAxis
								axisLine={false}
								tickFormatter={(value) =>
									formatTrendValue(selectedMetric, Number(value))
								}
								tickLine={false}
								width={36}
							/>
							<ChartTooltip
								content={
									<ChartTooltipContent
										formatter={(value) =>
											formatTrendValue(selectedMetric, Number(value))
										}
										indicator="line"
									/>
								}
								cursor={{
									stroke: "var(--border)",
									strokeDasharray: "4 4",
								}}
							/>
							<Area
								connectNulls={selectedMetric === "spend"}
								dataKey={selectedMetric}
								fill={`url(#${gradientId})`}
								fillOpacity={0.9}
								stroke={`var(--color-${selectedMetric})`}
								strokeWidth={2}
								type="monotone"
							/>
						</AreaChart>
					</ChartContainer>
				) : (
					<div className="flex h-[280px] items-center justify-center text-muted-foreground text-sm">
						No {metricDefinition.label.toLowerCase()} in this range.
					</div>
				)}
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
					{metricTiles.map(({ key: metricKey, ...tile }) => (
						<MetricTile
							key={tile.label}
							selected={metricKey === selectedMetric}
							{...tile}
						/>
					))}
				</div>
			</CardContent>
		</Card>
	);
}

function UsageDonut({
	data,
	title,
	description,
	testId,
}: {
	data: UsageBreakdownRow[];
	description: string;
	testId: string;
	title: string;
}) {
	const shown = data
		.filter(
			(entry) =>
				entry.requests > 0 ||
				(entry.spendMicroUsd !== null && entry.spendMicroUsd > 0)
		)
		.slice(0, 6);
	const chartData = shown.map((entry, index) => ({
		...entry,
		color: CHART_COLORS[index % CHART_COLORS.length],
		colorKey: `item${index}`,
		chartValue:
			entry.requests > 0 ? entry.requests : (entry.spendMicroUsd ?? 0),
	}));
	const total = shown.reduce((sum, entry) => sum + entry.requests, 0);
	const totalSpend = shown.reduce(
		(sum, entry) => sum + (entry.spendMicroUsd ?? 0),
		0
	);
	const config: ChartConfig = Object.fromEntries(
		chartData.map((entry, index) => [
			`item${index}`,
			{ color: entry.color, label: entry.label },
		])
	);

	return (
		<Card
			className={ANALYTICS_CARD_CLASS}
			data-testid={`usage-analytics-${testId}`}
		>
			<CardHeader className="gap-2">
				<CardTitle>{title}</CardTitle>
				<CardDescription className="max-w-md">{description}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{chartData.length > 0 ? (
					<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
						<div className="relative mx-auto h-[180px] w-[180px] shrink-0">
							<ChartContainer className="h-full w-full" config={config}>
								<PieChart accessibilityLayer>
									<ChartTooltip content={<ChartTooltipContent hideLabel />} />
									<Pie
										data={chartData}
										dataKey="chartValue"
										innerRadius={54}
										nameKey="label"
										outerRadius={78}
										paddingAngle={3}
										strokeWidth={0}
									>
										{chartData.map((entry) => (
											<Cell
												fill={`var(--color-${entry.colorKey})`}
												key={entry.key}
											/>
										))}
									</Pie>
								</PieChart>
							</ChartContainer>
							<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
								<span className="font-medium text-xl tabular-nums">
									{total > 0
										? formatCompact(total)
										: formatMicroUsd(totalSpend)}
								</span>
								<span className="text-[11px] text-muted-foreground">
									{total > 0 ? "requests" : "credit spend"}
								</span>
							</div>
						</div>
						<div className="flex min-w-0 flex-1 flex-col gap-2" role="list">
							{chartData.map((entry) => (
								<div
									className="flex items-center justify-between gap-3 rounded-2xl bg-muted/35 px-2.5 py-1.5 text-xs"
									key={entry.key}
									role="listitem"
								>
									<span className="flex min-w-0 items-center gap-2">
										<span
											aria-hidden="true"
											className="size-2 shrink-0 rounded-full"
											style={{ backgroundColor: entry.color }}
										/>
										<span className="truncate">{entry.label}</span>
									</span>
									<span className="shrink-0 text-right text-muted-foreground tabular-nums">
										{formatBreakdownValue(entry)}
									</span>
								</div>
							))}
						</div>
					</div>
				) : (
					<div className="flex h-[180px] items-center justify-center text-muted-foreground text-sm">
						No breakdown yet.
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function ActivityHeatmap({ data }: { data: UsageAnalyticsData }) {
	const points = data.buckets.slice(-56);
	const max = points.reduce(
		(highest, point) => Math.max(highest, point.requests),
		0
	);
	const leadingEmpty = (7 - (points.length % 7)) % 7;
	const cells: Array<UsageAnalyticsData["buckets"][number] | null> = [
		...Array.from({ length: leadingEmpty }, () => null),
		...points,
	];
	const axisLabels = points.slice(-7);
	const peak = points.reduce(
		(highest, point) => Math.max(highest, point.requests),
		0
	);
	return (
		<Card
			className={ANALYTICS_CARD_CLASS}
			data-testid="usage-analytics-chart-heatmap"
		>
			<CardHeader className="flex flex-row items-start justify-between gap-4">
				<div className="min-w-0">
					<CardTitle>Activity rhythm</CardTitle>
					<CardDescription>
						Quickly spot quiet periods and sustained usage.
					</CardDescription>
				</div>
				<CardAction className="ml-auto shrink-0 text-right">
					<div className="font-medium text-xl tabular-nums">{peak}</div>
					<div className="text-muted-foreground text-xs">peak requests</div>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<div className="flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
					<span>Less</span>
					{[0.08, 0.3, 0.55, 0.8, 1].map((opacity) => (
						<span
							aria-hidden="true"
							className="size-3 rounded-[4px] bg-primary"
							key={opacity}
							style={{ opacity }}
						/>
					))}
					<span>More</span>
				</div>
				<div
					aria-label="Usage activity heatmap"
					className="grid grid-cols-7 gap-1.5"
					role="img"
				>
					{cells.map((point, index) => {
						if (!point) {
							return (
								<span
									aria-hidden="true"
									className="aspect-square rounded-[4px]"
									key={`empty-${index}`}
								/>
							);
						}
						const intensity = max > 0 ? point.requests / max : 0;
						return (
							<span
								className="aspect-square rounded-[4px] bg-primary transition-opacity"
								key={point.start}
								style={{
									opacity: point.requests === 0 ? 0.08 : 0.2 + intensity * 0.8,
								}}
								title={`${point.label}: ${formatCompact(point.requests)} requests`}
							/>
						);
					})}
				</div>
				<div className="grid grid-cols-7 gap-1.5 text-center text-[10px] text-muted-foreground">
					{axisLabels.map((point) => (
						<span className="truncate" key={point.start}>
							{point.label}
						</span>
					))}
				</div>
			</CardContent>
		</Card>
	);
}

function FeatureMix({ data }: { data: UsageBreakdownRow[] }) {
	const shown = data.filter((entry) => entry.requests > 0).slice(0, 5);
	const max = shown.reduce(
		(highest, entry) => Math.max(highest, entry.requests),
		0
	);
	const total = shown.reduce((sum, entry) => sum + entry.requests, 0);
	return (
		<Card
			className={ANALYTICS_CARD_CLASS}
			data-testid="usage-analytics-chart-feature-mix"
		>
			<CardHeader className="gap-2">
				<CardTitle>Usage by feature</CardTitle>
				<CardDescription>
					Which product surfaces are driving the activity.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{shown.length > 0 ? (
					<div className="flex flex-col gap-3">
						{shown.map((entry, index) => (
							<div className="flex flex-col gap-1" key={entry.key}>
								<div className="flex items-center justify-between gap-3 text-xs">
									<span className="flex min-w-0 items-center gap-2">
										<span
											aria-hidden="true"
											className="size-2 shrink-0 rounded-full"
											style={{
												backgroundColor:
													CHART_COLORS[index % CHART_COLORS.length],
											}}
										/>
										<span className="truncate">{entry.label}</span>
									</span>
									<span className="shrink-0 text-muted-foreground tabular-nums">
										{formatCompact(entry.requests)} ·{" "}
										{total > 0
											? `${String(Math.round((entry.requests / total) * 100))}%`
											: "0%"}
									</span>
								</div>
								<div className="h-2.5 overflow-hidden rounded-full bg-muted/70">
									<div
										className="h-full rounded-full"
										style={{
											backgroundColor:
												CHART_COLORS[index % CHART_COLORS.length],
											width: `${Math.max(3, (entry.requests / max) * 100)}%`,
										}}
									/>
								</div>
							</div>
						))}
					</div>
				) : (
					<p className="text-muted-foreground text-sm">
						No feature attribution in this range.
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function RankedBreakdown({
	data,
	description,
	testId,
	title,
}: {
	data: UsageBreakdownRow[];
	description: string;
	testId: string;
	title: string;
}) {
	const shown = data
		.filter(
			(entry) =>
				entry.requests > 0 ||
				(entry.spendMicroUsd !== null && entry.spendMicroUsd > 0)
		)
		.slice(0, 6);
	const max = shown.reduce(
		(highest, entry) => Math.max(highest, entry.requests),
		0
	);
	const maxSpend = shown.reduce(
		(highest, entry) => Math.max(highest, entry.spendMicroUsd ?? 0),
		0
	);
	const denominator = max > 0 ? max : maxSpend;
	return (
		<Card
			className={ANALYTICS_CARD_CLASS}
			data-testid={`usage-analytics-${testId}`}
		>
			<CardHeader className="gap-2">
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				{shown.length > 0 ? (
					<div className="flex flex-col gap-3">
						{shown.map((entry, index) => (
							<div className="flex flex-col gap-1" key={entry.key}>
								<div className="flex items-center justify-between gap-3 text-xs">
									<span className="flex min-w-0 items-center gap-2">
										<span
											className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground tabular-nums"
											style={{
												color: CHART_COLORS[index % CHART_COLORS.length],
											}}
										>
											{index + 1}
										</span>
										<span className="truncate">{entry.label}</span>
									</span>
									<span className="shrink-0 text-right text-muted-foreground tabular-nums">
										{formatBreakdownValue(entry)}
									</span>
								</div>
								<div className="h-2 overflow-hidden rounded-full bg-muted/70">
									<div
										className="h-full rounded-full"
										style={{
											backgroundColor:
												CHART_COLORS[index % CHART_COLORS.length],
											width: `${Math.max(
												3,
												((max > 0
													? entry.requests
													: (entry.spendMicroUsd ?? 0)) /
													denominator) *
													100
											)}%`,
										}}
									/>
								</div>
							</div>
						))}
					</div>
				) : (
					<p className="text-muted-foreground text-sm">
						No breakdown in this range.
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function DateRangeControl({
	range,
	onChange,
}: {
	onChange: (range: UsageDateRange) => void;
	range: UsageDateRange;
}) {
	const [open, setOpen] = useState(false);
	const selected = {
		from: range.from,
		to: new Date(range.to.getTime() - 1),
	};
	const choosePreset = (days: number) => {
		const to = startOfDay(new Date());
		onChange({ from: addDays(to, -days + 1), to: addDays(to, 1) });
		setOpen(false);
	};
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger
				aria-label="Choose usage date range"
				className="inline-flex h-9 items-center gap-2 rounded-3xl border border-input bg-input/50 px-3 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
			>
				<HugeiconsIcon icon={Calendar03Icon} size={16} />
				<span className="max-w-48 truncate">{dateRangeLabel(range)}</span>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-auto">
				<div className="flex flex-col gap-3">
					<div className="flex flex-wrap gap-1">
						{[
							[1, "24 hours"],
							[7, "7 days"],
							[30, "30 days"],
							[90, "90 days"],
							[365, "12 months"],
						].map(([days, label]) => (
							<Button
								key={String(days)}
								onClick={() => choosePreset(Number(days))}
								size="sm"
								type="button"
								variant="ghost"
							>
								{label}
							</Button>
						))}
					</div>
					<Calendar
						defaultMonth={selected.from}
						disabled={{ after: new Date() }}
						mode="range"
						numberOfMonths={2}
						onSelect={(next) => {
							if (!next?.from) {
								return;
							}
							const from = startOfDay(next.from);
							const to = next.to
								? addDays(startOfDay(next.to), 1)
								: addDays(from, 1);
							onChange({ from, to });
							if (next.to) {
								setOpen(false);
							}
						}}
						selected={selected}
					/>
				</div>
			</PopoverContent>
		</Popover>
	);
}

export interface UsageAnalyticsDashboardProps {
	analytics: UsageAnalyticsData | null;
	failed?: boolean;
	granularity: UsageGranularity;
	loading: boolean;
	model: string | null;
	modelOptions?: string[];
	onGranularityChange: (value: UsageGranularity) => void;
	onModelChange: (value: string | null) => void;
	onProviderChange: (value: string | null) => void;
	onRangeChange: (value: UsageDateRange) => void;
	onRefresh?: () => void;
	onScopeChange: (value: UsageScope) => void;
	provider: string | null;
	providerOptions?: string[];
	range: UsageDateRange;
	scope: UsageScope;
}

export function UsageAnalyticsDashboard({
	analytics,
	failed = false,
	granularity,
	loading,
	model,
	onGranularityChange,
	onModelChange,
	onProviderChange,
	onRangeChange,
	onRefresh,
	onScopeChange,
	provider,
	providerOptions,
	modelOptions,
	range,
	scope,
}: UsageAnalyticsDashboardProps) {
	const providers = providerOptions ?? analytics?.providerOptions ?? [];
	const models = modelOptions ?? analytics?.modelOptions ?? [];
	const totals = analytics?.totals;
	return (
		<section
			aria-label="Usage analytics"
			className="flex flex-col gap-4"
			data-testid="usage-analytics-dashboard"
		>
			<div className="flex flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
					<h4 className="font-medium text-base">Usage analytics</h4>
					<Badge className="rounded-full" variant="outline">
						{SCOPE_LABELS[scope]}
					</Badge>
				</div>
				<p className="text-muted-foreground text-sm">
					{analytics?.caption ?? "Choose a scope to explore consumption."}
				</p>
			</div>

			<div
				className={`${ANALYTICS_CARD_CLASS} flex flex-col gap-2 p-2`}
				data-testid="usage-filter-rail"
			>
				<div className="flex flex-wrap items-center gap-2">
					<div className="flex items-center gap-1 rounded-2xl bg-muted/50 p-1">
						<span className="flex items-center gap-1.5 px-2 font-medium text-muted-foreground text-xs">
							<HugeiconsIcon icon={FilterIcon} size={14} />
							Scope
						</span>
						<ToggleGroup
							aria-label="Usage scope"
							className="rounded-2xl bg-transparent"
							multiple={false}
							onValueChange={(values: string[]) => {
								const [value] = values;
								if (SCOPE_VALUES.includes(value as UsageScope)) {
									onScopeChange(value as UsageScope);
								}
							}}
							spacing={0}
							value={[scope]}
							variant="default"
						>
							{SCOPE_VALUES.map((value) => (
								<ToggleGroupItem
									className="h-8 px-3 text-xs"
									key={value}
									value={value}
								>
									{SCOPE_LABELS[value]}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</div>
					<div className="flex items-center gap-1 rounded-2xl bg-muted/50 p-1">
						<span className="px-2 font-medium text-muted-foreground text-xs">
							Resolution
						</span>
						<ToggleGroup
							aria-label="Usage granularity"
							className="rounded-2xl bg-transparent"
							multiple={false}
							onValueChange={(values: string[]) => {
								const [value] = values;
								if (GRANULARITY_VALUES.includes(value as UsageGranularity)) {
									onGranularityChange(value as UsageGranularity);
								}
							}}
							spacing={0}
							value={[granularity]}
							variant="default"
						>
							{GRANULARITY_VALUES.map((value) => (
								<ToggleGroupItem
									className="h-8 px-2.5 text-xs"
									key={value}
									value={value}
								>
									{GRANULARITY_LABELS[value]}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</div>
					<DateRangeControl onChange={onRangeChange} range={range} />
				</div>
				<div className="flex flex-wrap items-center gap-2 border-border/50 border-t pt-2">
					<span className="px-2 font-medium text-muted-foreground text-xs">
						Narrow by
					</span>
					<Select
						onValueChange={(value) =>
							onProviderChange(value === "all" ? null : value)
						}
						value={provider ?? "all"}
					>
						<SelectTrigger
							aria-label="Filter by provider"
							className="min-w-40 border-border/50 bg-muted/50"
							size="sm"
							variant="default"
						>
							<span className="max-w-40 truncate">
								{provider ?? "All providers"}
							</span>
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								<SelectLabel>Provider</SelectLabel>
								<SelectItem value="all">All providers</SelectItem>
								{providers.map((value) => (
									<SelectItem key={value} value={value}>
										{value}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
					<Select
						onValueChange={(value) =>
							onModelChange(value === "all" ? null : value)
						}
						value={model ?? "all"}
					>
						<SelectTrigger
							aria-label="Filter by model"
							className="min-w-44 border-border/50 bg-muted/50"
							size="sm"
							variant="default"
						>
							<span className="max-w-44 truncate">{model ?? "All models"}</span>
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								<SelectLabel>Model</SelectLabel>
								<SelectItem value="all">All models</SelectItem>
								{models.map((value) => (
									<SelectItem key={value} value={value}>
										{value}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>
			</div>

			{analytics?.availability?.supported === false ? (
				<Alert data-testid="usage-analytics-availability" variant="info">
					<AlertDescription>{analytics.availability.message}</AlertDescription>
				</Alert>
			) : null}

			{loading && !analytics ? (
				<div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
					<Spinner /> Loading analytics…
				</div>
			) : null}

			{analytics ? (
				<>
					<div
						className={`grid grid-cols-2 gap-2 md:grid-cols-3 ${
							scope === "organization" ? "xl:grid-cols-7" : "xl:grid-cols-6"
						}`}
					>
						<KpiCard
							color={KPI_COLORS.requests}
							detail="Across the selected range"
							label="Requests"
							value={formatCompact(totals?.requests ?? 0)}
						/>
						<KpiCard
							color={KPI_COLORS.tokens}
							detail="Input + output"
							label="Tokens"
							value={formatCompact(
								(totals?.inputTokens ?? 0) + (totals?.outputTokens ?? 0)
							)}
						/>
						<KpiCard
							color={KPI_COLORS["credit spend"]}
							detail={
								scope === "node"
									? "Only if this node bills through Ryu"
									: "Debit-only consumption"
							}
							label="Credit spend"
							value={formatSpend(totals?.spendMicroUsd ?? null)}
						/>
						<KpiCard
							color={KPI_COLORS.errors}
							detail="Successful + failed calls"
							label="Errors"
							value={formatCompact(totals?.errors ?? 0)}
						/>
						<KpiCard
							color={KPI_COLORS["avg latency"]}
							detail="Average observed latency"
							label="Avg latency"
							value={formatMilliseconds(totals?.averageLatencyMs ?? null)}
						/>
						<KpiCard
							color={
								KPI_COLORS[scope === "you" ? "active days" : "active members"]
							}
							detail={
								scope === "organization"
									? "Members with activity"
									: scope === "node"
										? "Members observed"
										: "Days with activity"
							}
							label={scope === "you" ? "Active days" : "Active members"}
							value={formatCompact(
								scope === "you"
									? (totals?.activeDays ?? 0)
									: (totals?.activeMembers ?? 0)
							)}
						/>
						{scope === "organization" ? (
							<KpiCard
								color={KPI_COLORS["active nodes"]}
								detail="Nodes with activity"
								label="Active nodes"
								value={formatCompact(totals?.activeNodes ?? 0)}
							/>
						) : null}
					</div>

					<div className="grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
						<UsageTrend data={analytics} />
						<UsageDonut
							data={analytics.bySource}
							description="Managed credits are only one possible billing source."
							testId="chart-source"
							title="Consumption source"
						/>
					</div>
					<div className="grid gap-3 md:grid-cols-2">
						<UsageDonut
							data={analytics.byProvider}
							description="Compare providers before narrowing the dashboard."
							testId="chart-provider"
							title="Provider mix"
						/>
						<FeatureMix data={analytics.byFeature} />
					</div>
					<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
						<RankedBreakdown
							data={analytics.byModel}
							description="Most observed model calls in this scope."
							testId="chart-model"
							title="Top models"
						/>
						<RankedBreakdown
							data={analytics.byProvider}
							description="Request volume by provider."
							testId="chart-provider-ranking"
							title="Provider breakdown"
						/>
						<ActivityHeatmap data={analytics} />
					</div>
				</>
			) : loading || failed ? null : (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<HugeiconsIcon icon={Calendar03Icon} size={20} />
						</EmptyMedia>
						<EmptyTitle>No analytics loaded</EmptyTitle>
						<EmptyDescription>
							Choose a scope and range to explore usage.
						</EmptyDescription>
					</EmptyHeader>
					{onRefresh ? (
						<EmptyContent>
							<Button onClick={onRefresh} size="sm" variant="ghost">
								Refresh analytics
							</Button>
						</EmptyContent>
					) : null}
				</Empty>
			)}
		</section>
	);
}
