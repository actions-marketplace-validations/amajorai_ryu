"use client";

// A settings field that captures the WHOLE target the chat composer can express
// — agent, provider, model, thinking level, reasoning effort, and ACP access
// (permission) mode — as one controlled `AgentSelection` value.
//
// `AgentModelPickerField` (its sibling) persists a single id: a model id OR an
// agent id, never both, and deliberately hides thinking because a bare-string
// field has nowhere to put it. That is the right shape for a field that feeds
// one model id to one call. It is the wrong shape for "the default everything
// unset inherits", which has to be able to say "agent Claude Code, in plan mode"
// just as well as "gpt-5 at high effort".
//
// So this field reuses the exact same `UniversalPickerBody` (single source — see
// the composer) but emits the full object, and it is *controlled*: it mutates
// nothing live, unlike `useUniversalPicker`, which drives the running turn.
//
// The two halves are mutually exclusive by construction, because Core resolves
// them differently: picking an agent clears the provider/model, and picking a
// model clears the agent. A selection that named both would leave "which one
// wins" to the reader.
//
// Access mode and effort are read from what the picked agent actually advertises
// (`GET /api/agents/:id/acp-config`, the same data-driven contract the composer
// uses) rather than a hardcoded list, so an agent that advertises no modes shows
// no mode picker instead of a menu of options it would ignore.

import {
	ArrowDown01Icon,
	ArrowTurnBackwardIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Input } from "@ryu/ui/components/input";
import { Label } from "@ryu/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select";
import { cn } from "@ryu/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ComposerSettingsMenu } from "@/components/agent-elements/input/composer-settings-menu.tsx";
import {
	type ProviderEntry,
	UniversalPickerBody,
	type UniversalPickerData,
} from "@/components/agent-elements/input/universal-picker-body.tsx";
import { useAgents } from "@/src/hooks/useAgents.ts";
import { AgentLogo, engineForAgent } from "@/src/lib/agent-logos.tsx";
import { fetchAcpConfig } from "@/src/lib/api/acp.ts";
import type { AgentSummary } from "@/src/lib/api/agents.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import { fetchPiCatalog } from "@/src/lib/api/pi-config.ts";
import {
	type AgentSelection,
	EMPTY_AGENT_SELECTION,
	isAgentSelectionEmpty,
} from "@/src/lib/api/preferences.ts";
import { ProviderBrandLogo } from "@/src/lib/provider-brand.tsx";

/** Non-empty sentinel: Base UI Select is unreliable with empty-string values. */
const INHERIT = "__inherit__";

/** Map a Pi provider id to its brand-logo key (mirrors `useUniversalPicker`). */
const PROVIDER_ENGINE_KEY: Record<string, string> = {
	google: "gemini",
	"claude-pro-max": "claude",
	"openai-codex": "codex",
};

const NOOP = () => {
	// Field mode never reaches the composer-only actions (upsell / install /
	// configure-credentials / live save).
};

export interface AgentSelectionFieldProps {
	/** Accessible label for the trigger. */
	ariaLabel: string;
	className?: string;
	disabled?: boolean;
	onChange: (next: AgentSelection) => void;
	/** Shown when nothing is selected. */
	placeholder?: string;
	/** The Core node whose catalog/agents/ACP config this field reads. */
	target: ApiTarget;
	value: AgentSelection;
}

/** Free-text escape hatch: local, pinned and fine-tuned ids are in no catalog. */
function CustomModelRow({
	current,
	onCommit,
}: {
	current: string;
	onCommit: (id: string) => void;
}) {
	const [draft, setDraft] = useState(current);
	const commit = () => {
		const next = draft.trim();
		if (next) {
			onCommit(next);
		}
	};
	return (
		<div className="border-border/60 border-t p-1.5">
			<span className="px-1.5 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
				Custom model
			</span>
			<div className="flex items-center gap-1">
				<Input
					aria-label="Custom model id"
					className="h-7 text-[13px]"
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						}
					}}
					placeholder="Any model id (e.g. a local or pinned model)"
					value={draft}
				/>
				<button
					aria-label="Use this model"
					className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-40"
					disabled={!draft.trim()}
					onClick={commit}
					type="button"
				>
					<HugeiconsIcon icon={ArrowDown01Icon} size={14} />
				</button>
			</div>
		</div>
	);
}

/** "Use the default" row — the only way back to an unset field once picked. */
function InheritRow({ onClear }: { onClear: () => void }) {
	return (
		<div className="border-border/60 border-t p-1.5">
			<button
				className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-[13px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
				onClick={onClear}
				type="button"
			>
				<HugeiconsIcon icon={ArrowTurnBackwardIcon} size={14} />
				<span>Use the default</span>
			</button>
		</div>
	);
}

/** The trigger's leading brand/agent mark for the current selection, or null. */
function SelectionMark({
	agent,
	selection,
}: {
	agent: AgentSummary | null;
	selection: AgentSelection;
}) {
	if (selection.agent_id) {
		if (agent?.avatarUrl) {
			// biome-ignore lint/performance/noImgElement: Tauri/Vite, data URL avatar
			// biome-ignore lint/correctness/useImageSize: sized via class
			return (
				<img
					alt=""
					className="size-4 shrink-0 rounded-full object-cover"
					src={agent.avatarUrl}
				/>
			);
		}
		return (
			<AgentLogo
				className="size-4 shrink-0"
				engine={agent ? engineForAgent(agent) : null}
				size="16px"
			/>
		);
	}
	if (selection.provider) {
		return (
			<ProviderBrandLogo
				className="size-4 shrink-0"
				providerKey={selection.provider}
				size={16}
			/>
		);
	}
	return null;
}

/** One-line summary of a selection, e.g. `Claude Code · plan` or `gpt-5 · high`. */
function summarize(
	selection: AgentSelection,
	agent: AgentSummary | null
): string {
	const parts: string[] = [];
	if (selection.agent_id) {
		parts.push(agent?.name ?? selection.agent_id);
		if (selection.access_mode) {
			parts.push(selection.access_mode);
		}
	} else if (selection.model) {
		parts.push(selection.model);
	}
	if (selection.thinking_level) {
		parts.push(selection.thinking_level);
	}
	if (selection.effort && selection.effort !== selection.thinking_level) {
		parts.push(selection.effort);
	}
	return parts.join(" · ");
}

export function AgentSelectionField({
	value,
	onChange,
	target,
	ariaLabel,
	placeholder = "Use the default",
	className,
	disabled,
}: AgentSelectionFieldProps) {
	const catalogQuery = useQuery({
		queryKey: ["pi-catalog", target.url, target.token ?? ""],
		queryFn: () => fetchPiCatalog(target),
		staleTime: 5 * 60 * 1000,
		refetchOnWindowFocus: false,
	});
	const { agents } = useAgents();

	// What the SELECTED agent advertises: its permission modes and any
	// reasoning-effort-style config option. Only fetched once an agent is picked
	// (the probe spawns the agent subprocess, so it must not run speculatively).
	const acpQuery = useQuery({
		queryKey: ["acp-config", target.url, value.agent_id],
		queryFn: () => fetchAcpConfig(target, value.agent_id),
		enabled: Boolean(value.agent_id),
		staleTime: 5 * 60 * 1000,
		refetchOnWindowFocus: false,
		retry: 1,
	});

	const activeAgent = useMemo(
		() =>
			value.agent_id
				? (agents.find((a) => a.id === value.agent_id) ?? null)
				: null,
		[value.agent_id, agents]
	);

	// An agent pick and a provider/model pick are mutually exclusive: Core
	// resolves each differently, so storing both would be ambiguous.
	const pickAgent = (agentId: string) =>
		onChange({
			...value,
			agent_id: agentId,
			provider: "",
			model: "",
			thinking_level: "",
		});

	const pickModel = (providerId: string | null, modelId: string) =>
		onChange({
			...value,
			agent_id: "",
			access_mode: "",
			provider: providerId ?? "",
			model: modelId,
		});

	const data: UniversalPickerData = useMemo(() => {
		const providers: ProviderEntry[] = (catalogQuery.data?.providers ?? [])
			// The synthetic gateway pseudo-provider carries no models of its own.
			.filter((p) => p.id !== "gateway" && p.suggestedModels.length > 0)
			.map((p) => {
				const isActive = !value.agent_id && value.provider === p.id;
				return {
					id: p.id,
					label: p.label,
					engineKey: PROVIDER_ENGINE_KEY[p.id] ?? p.id,
					authKind: p.authKind,
					managed: false,
					// Keep real discovery so a discovery-capable provider shows its
					// full list, exactly as the composer does.
					supportsDiscovery: p.supportsDiscovery !== false,
					upsell: false,
					// Forced true: the field records ids; the Gateway resolves routing
					// at call time, so an unconfigured provider is still a valid pick.
					configured: true,
					isActive,
					currentModel: isActive ? value.model : null,
					currentThinking: isActive ? value.thinking_level : null,
					models: p.suggestedModels.map((m) => ({ id: m, name: m })),
				};
			});

		const flagship =
			agents.find((a) => a.id === "ryu") ??
			agents.find((a) => a.recommended) ??
			null;

		return {
			activeAgentId: value.agent_id || null,
			agents,
			activeModelSection: null,
			activeExtraSections: [],
			availableExternal: [],
			customAgents: agents.filter(
				(a) => a.transport !== "acp" && a.id !== flagship?.id
			),
			installedExternal: agents.filter(
				(a) => a.transport === "acp" && a.id !== flagship?.id
			),
			installPendingId: null,
			// A stored default must be a concrete target: the "Auto" sentinel is
			// resolved per-turn and would make the default recursive.
			hideAuto: true,
			ryuAgent: flagship,
			ryuActive: value.agent_id !== "" && value.agent_id === flagship?.id,
			providers,
			teams: [],
			thinkingLevels: catalogQuery.data?.thinkingLevels ?? [],
			onSelectAgent: pickAgent,
			onSelectProviderModel: (providerId, modelId) =>
				pickModel(providerId, modelId),
			onSelectProviderThinking: (providerId, level) =>
				onChange({
					...value,
					agent_id: "",
					access_mode: "",
					provider: providerId,
					thinking_level: level,
				}),
			onUseProvider: (providerId) => {
				const p = providers.find((x) => x.id === providerId);
				const first = p?.currentModel ?? p?.models[0]?.id;
				if (first) {
					pickModel(providerId, first);
				}
			},
			onConfigureAuto: NOOP,
			onConfigureCredentials: NOOP,
			onCreateAgent: undefined,
			onInstallExternal: NOOP,
			onSelectTeam: undefined,
			onUpgrade: NOOP,
		};
		// `onChange`/`value` drive every handler above; agents + catalog drive the rows.
	}, [catalogQuery.data, agents, value, onChange]);

	// Effort options: what the picked agent advertises (its `thoughtLevel`-style
	// select), else Pi's thinking levels for a provider/model pick.
	const agentEffortOption = useMemo(() => {
		const options = acpQuery.data?.configOptions ?? [];
		return (
			options.find((o) => o.category === "thoughtLevel") ??
			options.find((o) => /effort|reasoning|thinking/i.test(o.name ?? "")) ??
			null
		);
	}, [acpQuery.data]);

	const effortItems = useMemo(() => {
		if (agentEffortOption) {
			const raw = agentEffortOption.options ?? [];
			const flat = raw.flatMap((o) =>
				"options" in o ? o.options : [o as { name: string; value: string }]
			);
			return flat.map((o) => ({ value: o.value, label: o.name || o.value }));
		}
		return (catalogQuery.data?.thinkingLevels ?? []).map((l) => ({
			value: l,
			label: l,
		}));
	}, [agentEffortOption, catalogQuery.data]);

	const accessModes = acpQuery.data?.modes?.availableModes ?? [];
	const label = summarize(value, activeAgent) || placeholder;

	return (
		<div className={cn("space-y-3", className)}>
			<ComposerSettingsMenu
				align="end"
				renderBody={(close) => (
					<>
						<UniversalPickerBody close={close} data={data} />
						<CustomModelRow
							current={value.model}
							onCommit={(id) => {
								// Free-typed id — no owning provider to record.
								pickModel(null, id);
								close();
							}}
						/>
						{!isAgentSelectionEmpty(value) && (
							<InheritRow
								onClear={() => {
									onChange(EMPTY_AGENT_SELECTION);
									close();
								}}
							/>
						)}
					</>
				)}
				sections={[]}
				side="bottom"
				trigger={
					<button
						aria-label={ariaLabel}
						className="flex h-8 w-full items-center gap-2 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
						disabled={disabled}
						type="button"
					>
						<SelectionMark agent={activeAgent} selection={value} />
						<span
							className={cn(
								"min-w-0 flex-1 truncate text-left",
								isAgentSelectionEmpty(value)
									? "text-muted-foreground"
									: "text-foreground"
							)}
						>
							{label}
						</span>
						<HugeiconsIcon
							className="shrink-0 text-muted-foreground"
							icon={ArrowDown01Icon}
							size={14}
						/>
					</button>
				}
			/>

			{effortItems.length > 0 && (
				<div className="flex flex-col gap-1.5">
					<Label className="text-muted-foreground text-xs">
						Thinking / effort level
					</Label>
					<Select
						items={[
							{ value: INHERIT, label: "Provider default" },
							...effortItems,
						]}
						onValueChange={(v) =>
							onChange({ ...value, effort: v && v !== INHERIT ? v : "" })
						}
						value={value.effort || INHERIT}
					>
						<SelectTrigger className="h-8 text-sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem className="text-sm" value={INHERIT}>
								Provider default
							</SelectItem>
							{effortItems.map((it) => (
								<SelectItem className="text-sm" key={it.value} value={it.value}>
									{it.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}

			{/* Access mode is agent-only: a raw model call has no permission surface,
			    and the agent's own advertised set is the only honest option list. */}
			{value.agent_id && accessModes.length > 0 && (
				<div className="flex flex-col gap-1.5">
					<Label className="text-muted-foreground text-xs">Access mode</Label>
					<Select
						items={[
							{ value: INHERIT, label: "Agent default" },
							...accessModes.map((m) => ({ value: m.id, label: m.name })),
						]}
						onValueChange={(v) =>
							onChange({ ...value, access_mode: v && v !== INHERIT ? v : "" })
						}
						value={value.access_mode || INHERIT}
					>
						<SelectTrigger className="h-8 text-sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem className="text-sm" value={INHERIT}>
								Agent default
							</SelectItem>
							{accessModes.map((m) => (
								<SelectItem className="text-sm" key={m.id} value={m.id}>
									{m.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}
		</div>
	);
}
