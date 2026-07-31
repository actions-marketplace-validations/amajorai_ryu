"use client";

import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DropdownMenuItem } from "@ryu/ui/components/dropdown-menu";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@ryu/ui/components/hover-card";
import { Input } from "@ryu/ui/components/input";
import { cn } from "@ryu/ui/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { COMPOSER_SELECT_ITEM } from "@/components/agent-elements/input/composer-select.ts";
import {
	type ModelMenuOption,
	sortModelGroups,
} from "@/components/agent-elements/input/model-groups.ts";
import { ModelHoverPreview } from "@/components/agent-elements/input/model-hover-preview.tsx";
import { ModelUsageBadge } from "@/components/agent-elements/input/usage-bar.tsx";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import {
	getModelInsight,
	type ModelInsight,
} from "@/src/lib/api/model-insight.ts";

/** Process-lifetime cache so re-hovering the same model is instant. */
const insightCache = new Map<string, ModelInsight | null>();

function cacheKey(modelId: string, provider: string | null): string {
	return `${provider ?? ""}::${modelId}`;
}

function providerFromModelId(modelId: string): string | null {
	const slash = modelId.indexOf("/");
	if (slash <= 0) {
		return null;
	}
	return modelId.slice(0, slash);
}

function ModelRow({
	model,
	isActive,
	onSelect,
	target,
	usageAgentId,
}: {
	model: ModelMenuOption;
	isActive: boolean;
	onSelect: (modelId: string) => void;
	target: { url: string; token: string | null };
	/**
	 * The subscription agent these models belong to, when it has per-model quotas
	 * worth showing (Claude's weekly Sonnet/Opus limits, Codex's Spark). Null for
	 * Ryu's own Gateway-routed models, which have no vendor window.
	 */
	usageAgentId?: string | null;
}) {
	const [open, setOpen] = useState(false);
	const [insight, setInsight] = useState<ModelInsight | null>(null);
	const [loading, setLoading] = useState(false);

	const provider = providerFromModelId(model.id);

	useEffect(() => {
		if (!open) {
			return;
		}
		const key = cacheKey(model.id, provider);
		if (insightCache.has(key)) {
			setInsight(insightCache.get(key) ?? null);
			setLoading(false);
			return;
		}
		let cancelled = false;
		setLoading(true);
		getModelInsight(target, model.id, provider)
			.then((result) => {
				insightCache.set(key, result);
				if (!cancelled) {
					setInsight(result);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open, model.id, provider, target]);

	const row = (
		<DropdownMenuItem
			className={cn(
				COMPOSER_SELECT_ITEM,
				"flex-col items-start gap-0.5",
				isActive && "bg-accent"
			)}
			closeOnClick={false}
			onClick={() => onSelect(model.id)}
		>
			<span className="flex w-full items-center gap-2.5">
				<span className="flex-1 truncate">{model.name}</span>
				{usageAgentId ? (
					<ModelUsageBadge
						agentId={usageAgentId}
						modelId={model.id}
						modelName={model.name}
					/>
				) : null}
				{isActive ? (
					<HugeiconsIcon
						className="shrink-0 text-muted-foreground"
						icon={Tick02Icon}
						size={16}
						strokeWidth={2}
					/>
				) : null}
			</span>
			{model.description ? (
				<span className="w-full truncate text-left font-normal text-muted-foreground text-xs">
					{model.description}
				</span>
			) : null}
		</DropdownMenuItem>
	);

	const showCard = open && (loading || insight !== null);

	return (
		<HoverCard onOpenChange={setOpen} open={open}>
			<HoverCardTrigger closeDelay={100} delay={350} render={row} />
			{showCard ? (
				<HoverCardContent
					align="start"
					className="z-[80] w-auto max-w-[18rem] p-3"
					side="right"
					sideOffset={8}
				>
					{insight ? (
						<ModelHoverPreview insight={insight} />
					) : (
						<div className="flex w-[16.5rem] flex-col gap-2">
							<div className="h-3.5 w-2/3 animate-pulse rounded bg-muted-foreground/15" />
							<div className="grid grid-cols-2 gap-2">
								<div className="h-6 animate-pulse rounded bg-muted-foreground/10" />
								<div className="h-6 animate-pulse rounded bg-muted-foreground/10" />
								<div className="h-6 animate-pulse rounded bg-muted-foreground/10" />
								<div className="h-6 animate-pulse rounded bg-muted-foreground/10" />
							</div>
						</div>
					)}
				</HoverCardContent>
			) : null}
		</HoverCard>
	);
}

export function ModelMenuContent({
	models,
	activeId,
	onSelect,
	usageAgentId,
}: {
	models: ModelMenuOption[];
	activeId?: string;
	onSelect: (modelId: string) => void;
	/** See `ModelRow.usageAgentId`. */
	usageAgentId?: string | null;
}) {
	const node = useActiveNode();
	const target = useMemo(
		() => ({ url: node.url, token: node.token ?? null }),
		[node.url, node.token]
	);
	const [query, setQuery] = useState("");
	const normalizedQuery = query.trim().toLowerCase();

	const groups = useMemo(() => {
		const filtered = normalizedQuery
			? models.filter((model) => {
					const hay =
						`${model.name} ${model.id} ${model.description ?? ""} ${model.group ?? ""}`.toLowerCase();
					return hay.includes(normalizedQuery);
				})
			: models;

		const grouped: { label: string | null; items: ModelMenuOption[] }[] = [];
		for (const model of filtered) {
			const label = model.group ?? null;
			const existing = grouped.find((g) => g.label === label);
			if (existing) {
				existing.items.push(model);
			} else {
				grouped.push({ label, items: [model] });
			}
		}
		return sortModelGroups(grouped);
	}, [models, normalizedQuery]);

	const hasGroups = groups.some((g) => g.label !== null);

	const renderRow = (model: ModelMenuOption) => (
		<ModelRow
			isActive={model.id === activeId}
			key={model.id}
			model={model}
			onSelect={onSelect}
			target={target}
			usageAgentId={usageAgentId}
		/>
	);

	return (
		<div className="flex max-h-80 flex-col">
			<div className="sticky top-0 z-10">
				<Input
					aria-label="Filter models"
					className="h-8 text-[13px]"
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search models…"
					value={query}
				/>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-1">
				{groups.length === 0 ? (
					<p className="px-3 py-4 text-center text-muted-foreground text-xs">
						No models match &ldquo;{query.trim()}&rdquo;
					</p>
				) : null}
				{hasGroups
					? groups.map((group) => (
							<div key={group.label ?? "__ungrouped__"}>
								{group.label ? (
									<div className="px-3 pt-2 pb-1 font-medium text-[11px] text-muted-foreground">
										{group.label}
									</div>
								) : null}
								{group.items.map(renderRow)}
							</div>
						))
					: filteredFlat(groups).map(renderRow)}
			</div>
		</div>
	);
}

export function createModelMenuRenderer(
	models: ModelMenuOption[],
	activeId?: string,
	usageAgentId?: string | null
) {
	return (onSelect: (id: string) => void) => (
		<ModelMenuContent
			activeId={activeId}
			models={models}
			onSelect={onSelect}
			usageAgentId={usageAgentId}
		/>
	);
}

function filteredFlat(
	groups: { label: string | null; items: ModelMenuOption[] }[]
): ModelMenuOption[] {
	return groups.flatMap((g) => g.items);
}
