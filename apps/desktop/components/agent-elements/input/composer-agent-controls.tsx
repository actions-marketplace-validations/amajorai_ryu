"use client";

// The one place the chat composer's LEFT control cluster is defined.
//
// ChatPage, the launchpad (empty-tabs home), and the Ask Ryu dock all render the
// exact same bar — a single `ComposerSettingsMenu` (Agent · Model · … one trigger,
// sections inside), then read-only `CapabilityBadges`, then the subscription
// `UsageBar` — because every one of them gets it from this hook. Before this, each
// surface re-derived the mode list and re-wired the ACP hide / team-prefix / create
// sentinel by hand, and only ChatPage bolted on the badges + usage meters, so the
// launchpad and dock silently drifted into a lighter, different-looking bar. This
// module is that derivation once, so the three surfaces read identically and can
// never drift apart again.
//
// `useComposerAgentModes` builds the `ModeOption[]` from the live registry;
// `useComposerAgentControls` returns `{ leftActions, rightActions, sections }` — the
// first two a host spreads straight into `InputBar` (`rightActions` is always `null`
// — model lives in the settings menu), and `sections` the composed Agent · Model ·
// Thinking list so a surface with its own trigger (the empty-state agent logo) can
// open the IDENTICAL dropdown via `ComposerSettingsMenu`'s `trigger` prop. It is
// controlled — the caller owns the agent/team/model
// selection state (localStorage on the launchpad, a `BuilderRuntime` in the dock,
// ChatPage's own state) — and surfaces with a richer picker (ChatPage's ACP model
// chain + approval/config sections) feed those in via `modelSection`/`extraSections`.
// The capability badges + usage meters are derived from `agentId` inside the hook, so
// every surface that names an agent gets them for free.

import { Add01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComposerModelSection } from "@ryu/blocks/composer/composer-acp-sections";
import { acpHarnessSuffix } from "@ryu/blocks/composer/composer-trigger-summary";
import { type ReactNode, useMemo } from "react";
import { CapabilityBadges } from "@/components/agent-elements/input/capability-badges.tsx";
import {
	ComposerSettingsMenu,
	type ComposerSettingsSection,
} from "@/components/agent-elements/input/composer-settings-menu.tsx";
import { ManageModelsButton } from "@/components/agent-elements/input/manage-models-button.tsx";
import {
	ModeMenuContent,
	type ModeOption,
} from "@/components/agent-elements/input/mode-selector.tsx";
import { AUTO_AGENT_ID } from "@/components/agent-elements/input/universal-picker-body.tsx";
import { UsageBar } from "@/components/agent-elements/input/usage-bar.tsx";
import {
	NO_OUTPUT_STYLE_ID,
	useComposerOutputStyleSection,
} from "@/components/agent-elements/input/use-composer-output-style-section.ts";
import { useUniversalPicker } from "@/components/agent-elements/input/use-universal-picker.ts";
import type { InputBarInfoBar } from "@/components/agent-elements/input-bar.tsx";
import type { ModelOption } from "@/components/agent-elements/types.ts";
import { useAgentCapabilities } from "@/src/hooks/useAgentCapabilities.ts";
import { useInterfaceLevel } from "@/src/hooks/useInterfaceLevel.ts";
import { usePiConfig } from "@/src/hooks/usePiConfig.ts";
import { useRoutingAdvice } from "@/src/hooks/useRoutingAdvice.ts";
import {
	engineForAgent,
	getAgentIcon,
	getTeamStackIcon,
} from "@/src/lib/agent-logos.tsx";
import type { AgentSummary } from "@/src/lib/api/agents.ts";
import { filterEnabledModels } from "@/src/lib/api/pi-config.ts";
import type { Team } from "@/src/lib/api/teams.ts";
import {
	showsComposerTuning,
	showsModelPicker,
} from "@/src/lib/interface-level.ts";

/** Sentinel `ModeSelector` value that routes to the "create a new agent" flow. */
export const CREATE_AGENT_MODE = "__create_agent__";
/** Team ids are namespaced in the picker so they can't collide with agent ids. */
export const TEAM_MODE_PREFIX = "team:";

/** The "New agent…" leading icon for the agent picker's create sentinel. */
export function NewAgentModeIcon({ className }: { className?: string }) {
	return <HugeiconsIcon className={className} icon={Add01Icon} />;
}

/** The "Auto" leading icon for the composer trigger when the `auto` sentinel is active. */
function AutoModeIcon({ className }: { className?: string }) {
	return <HugeiconsIcon className={className} icon={SparklesIcon} />;
}

export interface ComposerAgentModesOptions {
	/** Append the "New agent…" create sentinel row. Default: true. */
	includeCreate?: boolean;
	/** Append a "Teams" section addressable as one target. Default: true. */
	includeTeams?: boolean;
}

/**
 * The composer's agent picker options, derived from the live agent/team registry
 * with each entry's engine (or team-stack) logo — never hardcoded. Agents render
 * under an "Agents" group, teams under "Teams", and an optional "New agent…"
 * sentinel closes the list.
 */
export function useComposerAgentModes(
	agents: AgentSummary[],
	teams: Team[] = [],
	{ includeTeams = true, includeCreate = true }: ComposerAgentModesOptions = {}
): ModeOption[] {
	return useMemo(() => {
		const agentOptions = agents.map<ModeOption>((a) => ({
			id: a.id,
			label: a.name,
			icon: getAgentIcon(a.avatarUrl, engineForAgent(a)),
			description: a.description ?? undefined,
			group: "Agents",
		}));
		const teamOptions =
			includeTeams && teams.length > 0
				? teams.map<ModeOption>((t) => ({
						id: `${TEAM_MODE_PREFIX}${t.id}`,
						label: t.name,
						icon: getTeamStackIcon(
							t.members.map((id) => {
								const member = agents.find((a) => a.id === id);
								return member ? engineForAgent(member) : null;
							})
						),
						description: t.description ?? undefined,
						group: "Teams",
					}))
				: [];
		return [
			...agentOptions,
			...teamOptions,
			...(includeCreate
				? [
						{
							id: CREATE_AGENT_MODE,
							label: "New agent…",
							icon: NewAgentModeIcon,
						} satisfies ModeOption,
					]
				: []),
		];
	}, [agents, teams, includeTeams, includeCreate]);
}

// `ComposerModelSection` — the caller-supplied override for the Model section
// (the ACP-models / config-option / engine-catalog chain) — is owned by
// `@ryu/blocks/composer/composer-acp-sections`, alongside the derivation that
// produces it, so desktop and the island cannot drift apart on its shape.

export interface ComposerAgentControlsConfig {
	/** Currently selected agent id, or null when a team is the active target. */
	agentId: string | null;
	/** Live agent registry (drives both the picker options and ACP detection). */
	agents: AgentSummary[];
	/**
	 * True when sending would OPEN a conversation rather than continue one (an
	 * empty thread, the launchpad). Only affects the threshold-fallback notice:
	 * a rule that swaps the whole agent applies at a conversation start only,
	 * because an ACP agent owns its own session state. Defaults to false, the
	 * conservative read — the notice then says "new conversations will start on
	 * X" instead of promising a switch to this thread.
	 */
	atConversationStart?: boolean;
	/**
	 * Denser composer (used once a chat has history). It is a DENSITY flag, not a
	 * layout one: the control cluster is left-aligned in the stacked controls row
	 * on every surface, exactly as the launchpad renders it, so compact and full
	 * cannot drift into two arrangements. What compact still changes is size —
	 * the settings-menu trigger shortens to `[logo] agent [usage] ⌄` (it implies
	 * {@link compactTrigger}) and the subscription usage meters fold INTO that
	 * trigger as trailing rather than sitting beside it as a standalone chip.
	 */
	compact?: boolean;
	/**
	 * Compact the settings-menu trigger to `[logo] agent [usage] ⌄` without
	 * moving the cluster to the right. Used by narrow surfaces (Ask Ryu floating
	 * / docked) that keep the roomy stacked textarea but still need the short
	 * trigger. Ignored when {@link compact} is true (that already includes it).
	 */
	compactTrigger?: boolean;
	/**
	 * Extra `ComposerSettingsMenu` sections appended after Agent + Model — e.g.
	 * ChatPage's Approval (permission mode) and any agent-advertised config
	 * options. Empty sections are auto-hidden by the menu.
	 */
	extraSections?: ComposerSettingsSection[];
	/** Currently selected model id (used when `modelSection` is omitted). */
	model: string | null;
	/** Map a model's display name (e.g. friendly mode). Ignored with `modelSection`. */
	modelLabel?: (raw: string) => string;
	/** Model options for the active agent (built via `modelsForAgent`). */
	modelOptions: ModelOption[];
	/** Fully override the Model section (ChatPage's ACP/config/engine chain). */
	modelSection?: ComposerModelSection;
	/** Open the create-agent flow. Omit to hide the "New agent…" sentinel. */
	onCreateAgent?: () => void;
	/** Persist a model pick for the active agent (used when `modelSection` omitted). */
	onModelChange: (modelId: string) => void;
	/** Pick an agent as the driving target (real agent id only; sentinels handled here). */
	onSelectAgent: (agentId: string) => void;
	/** Pick a team as the driving target. Omit to hide the Teams section. */
	onSelectTeam?: (teamId: string) => void;
	/** Currently selected team id, or null when an agent is the active target. */
	teamId?: string | null;
	/** Live teams; pass `[]` (or omit `onSelectTeam`) to disable the Teams section. */
	teams?: Team[];
}

/**
 * The shared composer controls: `{ leftActions, rightActions }` ready to spread
 * into `InputBar`. This is the ONE definition of the chat bar's left cluster, so
 * ChatPage, the launchpad, and the Ask Ryu dock render an identical bar:
 *
 *   [ Agent · Model · … settings ]  [ capability badges ]  [ usage meters ]
 *
 * `leftActions` merges the agent/model/approval pickers into a single
 * `ComposerSettingsMenu` (Codex-style: one trigger, sections inside), followed by
 * the read-only `CapabilityBadges` and the subscription `UsageBar` — both derived
 * from `agentId`, so every surface that names an agent gets them for free.
 * `rightActions` is `null`: model selection lives in the settings menu.
 */
export function useComposerAgentControls(config: ComposerAgentControlsConfig): {
	/**
	 * The threshold-fallback notice for the turn about to be sent, ready to spread
	 * into `InputBar`'s `infoBar` prop — "Ryu credit is at $3.10 (under your $5.00
	 * rule) — running this turn on gpt-5-mini."
	 *
	 * It lives HERE, next to the agent/model pickers, for the same reason the
	 * `UsageBar` does: every composer surface derives it from this one hook, so
	 * the dock and the launchpad cannot silently ship a composer that swaps a
	 * model without saying so. `undefined` when there is nothing to report, which
	 * is the case on any node with no rules configured.
	 */
	infoBar: InputBarInfoBar | undefined;
	leftActions: ReactNode;
	/**
	 * Re-ask Core for the fallback verdict. A host calls this right after sending
	 * a turn, so the bar reflects the headroom that turn just consumed.
	 */
	refreshRoutingAdvice: () => void;
	rightActions: ReactNode;
	/**
	 * The universal picker body (Ryu (providers nested) · External Agents),
	 * exposed alongside `sections` so a surface with its own trigger (the
	 * empty-state agent logo) opens the IDENTICAL dropdown via
	 * `ComposerSettingsMenu`'s `trigger` + `renderBody` props.
	 */
	renderBody: (close: () => void) => ReactNode;
	/**
	 * The composed Agent · Model · Approval/Thinking sections, exposed so the
	 * trigger summary (`Ryu · Sonnet · Plan`) stays glanceable on a surface with
	 * its own trigger. The body itself now comes from `renderBody`.
	 *
	 * The Output style section joins this list only while a style is actually in
	 * force — see the note at its construction. It is always in the picker body.
	 */
	sections: ComposerSettingsSection[];
} {
	const {
		agents,
		atConversationStart = false,
		teams = [],
		agentId,
		teamId = null,
		onSelectAgent,
		onSelectTeam,
		onCreateAgent,
		modelOptions,
		model,
		onModelChange,
		modelSection,
		modelLabel,
		extraSections = [],
		compact = false,
		compactTrigger = false,
	} = config;

	const modes = useComposerAgentModes(agents, teams, {
		includeTeams: Boolean(onSelectTeam),
		includeCreate: Boolean(onCreateAgent),
	});
	// Read-only capability badges + usage meters follow the active agent — the
	// same `agentId`-keyed hooks ChatPage uses, so all three surfaces match.
	// Pass the selected model so GGUF detection (vision/mmproj, template tools)
	// tracks the composer's model pick, not just the agent's bound slot.
	const { capabilities } = useAgentCapabilities(agentId, model);
	const { catalog: piCatalog } = usePiConfig();

	// Threshold fallback: what Core would actually run this turn, given how much
	// Ryu credit / provider balance / subscription window is left. Derived here
	// so every composer surface reports it identically — see the `infoBar` note on
	// this hook's return type.
	const { advice, refresh: refreshRoutingAdvice } = useRoutingAdvice(
		agentId,
		model,
		atConversationStart
	);
	const infoBar = useMemo<InputBarInfoBar | undefined>(() => {
		if (!advice?.reason) {
			return undefined;
		}
		return {
			// A swap already happened to the turn; a warning is a heads-up. Both are
			// informational — neither is an error, so neither takes the destructive
			// red wash the composer reserves for failures.
			title: advice.severity === "swap" ? "Fallback applied" : "Running low",
			description: advice.reason,
		};
	}, [advice?.reason, advice?.severity]);

	const handleModeChange = (next: string) => {
		if (next === CREATE_AGENT_MODE) {
			onCreateAgent?.();
			return;
		}
		if (next.startsWith(TEAM_MODE_PREFIX)) {
			onSelectTeam?.(next.slice(TEAM_MODE_PREFIX.length));
			return;
		}
		onSelectAgent(next);
	};

	const activeAgentValue = teamId
		? `${TEAM_MODE_PREFIX}${teamId}`
		: (agentId ?? undefined);
	// The `auto` sentinel is never in `modes` (it's Core's per-turn agent router,
	// not a concrete agent), so synthesize its active row so the trigger reads
	// "Auto" with a sparkle instead of silently falling back to the first agent.
	const autoMode: ModeOption = {
		id: AUTO_AGENT_ID,
		label: "Auto",
		icon: AutoModeIcon,
	};
	const activeMode =
		agentId === AUTO_AGENT_ID
			? autoMode
			: (modes.find((m) => m.id === activeAgentValue) ?? modes[0]);

	const activeAgent = agents.find((a) => a.id === agentId);
	// Which ACP harness is actually driving, when the agent's own name does not
	// already say so — `Ryu (pi)`, never `OpenCode (opencode)`. It rides the agent
	// name rather than taking a bullet of its own, and it is derived from the
	// agent's advertised engine, so a store-backed custom agent (whose engine
	// Core's list endpoint omits) gets no suffix rather than a guess.
	const harness =
		activeAgent?.transport === "acp"
			? acpHarnessSuffix(activeMode?.label, engineForAgent(activeAgent))
			: null;

	// Agent section — grouped, icon'd rows via ModeMenuContent (identical to
	// ChatPage). The trigger summary shows the active agent/team name.
	const agentSection: ComposerSettingsSection = {
		key: "agent",
		label: "Agent",
		ariaLabel: "Select agent",
		activeName:
			activeMode?.label && harness
				? `${activeMode.label} (${harness})`
				: activeMode?.label,
		items: modes.map((m) => ({
			id: m.id,
			name: m.label,
			description: m.description,
		})),
		value: activeAgentValue,
		onChange: handleModeChange,
		renderContent: (onSelect) => (
			<ModeMenuContent
				activeId={activeMode?.id}
				modes={modes}
				onSelect={onSelect}
			/>
		),
	};

	// Model section — caller override (ChatPage's ACP/config/engine chain) or the
	// built-in engine catalog. ACP agents advertise their own models in-chat, so
	// with no override their catalog section is empty (and thus auto-hidden).
	// Per-model visibility for THIS agent (Settings → Providers → Agents), from
	// the shared Pi catalog query.
	const agentModelOverrides = agentId
		? piCatalog?.agentModelOverrides?.[agentId]
		: undefined;
	const activeAgentIsAcp = activeAgent?.transport === "acp";
	// Capability badges (tools / thinking / vision) only carry meaning for local
	// models — where the effective capabilities are genuinely variable and detected
	// per model. For external ACP harnesses (Claude Code, Codex, Gemini CLI,
	// OpenClaw, Hermes, …) they're noise: those engines obviously do all three. So
	// show badges for openai-compat / local / custom agents and for the flagship
	// Ryu (whose transport is `acp:pi` but which runs a local model), and hide them
	// for every other ACP harness.
	const showCapabilityBadges = !activeAgentIsAcp || activeAgent?.recommended;
	const label = modelLabel ?? ((raw: string) => raw);
	const modelSectionResolved: ComposerSettingsSection = modelSection
		? {
				key: "model",
				label: "Model",
				ariaLabel: "Select model",
				items: modelSection.items,
				value: modelSection.value,
				onChange: modelSection.onChange,
				renderContent: modelSection.renderContent,
				loading: modelSection.loading,
			}
		: {
				key: "model",
				label: "Model",
				ariaLabel: "Select model",
				// Without a caller override this is the engine catalog; it obeys the
				// same per-agent visibility toggles the override path applies, so a
				// hidden model does not reappear on the surfaces that use this branch.
				items: activeAgentIsAcp
					? []
					: filterEnabledModels(
							modelOptions.map((m) => ({ id: m.id, name: label(m.name) })),
							agentModelOverrides,
							model
						),
				value: model ?? undefined,
				onChange: onModelChange,
			};

	// Output style (`docs/output-styles.md` §6) — the ONE place it is wired, so every
	// composer surface offers it and no surface hand-rolls its own. It comes after the
	// caller's own extra sections because those (approval, thinking, agent-advertised
	// config) tune the active TARGET, while a style is a node-wide prompt preset that
	// outlives whichever agent is selected. Empty when the node has no styles, and
	// every consumer auto-hides an empty section.
	const outputStyleSection = useComposerOutputStyleSection();
	// Interface level decides how much of this bar exists at all (see
	// `@/src/lib/interface-level.ts`). At Simple the composer is the agent picker
	// and nothing else; Standard adds the model; Advanced/Expert add the tuning
	// sections (approval mode, thinking budget, agent config options, output
	// style). Gating happens HERE, in the one hook all three composer surfaces
	// share, so the chat page, the launchpad and the Ask Ryu dock cannot disagree
	// about what a level means.
	//
	// Hidden is not disabled: an agent still runs on whatever model, approval mode
	// and thinking budget it is configured with — the per-agent settings page is
	// where those live at any level. This only decides whether the CHAT BAR
	// carries them.
	const interfaceLevel = useInterfaceLevel();
	const showModelSection = showsModelPicker(interfaceLevel);
	const showTuningSections = showsComposerTuning(interfaceLevel);
	const bodySections = useMemo(
		() => (showTuningSections ? [...extraSections, outputStyleSection] : []),
		[extraSections, outputStyleSection, showTuningSections]
	);

	// The trigger summary reads `Ryu · Sonnet · Plan`; a style earns a segment there
	// only once one is actually in force. "None" is the shipped default (design §8),
	// so summarising it would add a permanent, meaningless fourth segment to every
	// composer — while an ACTIVE style genuinely belongs there, since it is the only
	// signal that the agent's answers are being reshaped.
	const styleInForce =
		showTuningSections &&
		outputStyleSection.items.length > 0 &&
		outputStyleSection.value !== NO_OUTPUT_STYLE_ID;
	// The summary has to describe the popover it opens, so it is filtered by the
	// same level: a trigger reading `Ryu · Sonnet` above a body with no model row
	// is worse than either half alone.
	const sections = [
		agentSection,
		...(showModelSection ? [modelSectionResolved] : []),
		...(showTuningSections ? extraSections : []),
		...(styleInForce ? [outputStyleSection] : []),
	];

	// The universal picker body (Ryu (providers nested) · External Agents) that
	// replaces the sibling-submenu list. The trigger summary still derives from
	// `sections`, so `Ryu · Sonnet · Plan` is unchanged; only the popover changes.
	// The active agent's live model/approval/thinking sections are threaded in so
	// tuning the current target still wires to the host's live handlers.
	const { renderBody } = useUniversalPicker({
		agents,
		agentId,
		teamId,
		teams,
		onSelectAgent,
		onSelectTeam,
		onCreateAgent,
		activeModelSection: showModelSection ? modelSectionResolved : null,
		activeExtraSections: bodySections,
	});

	// Leading mark: a custom-agent avatar image wins, else the active mode's engine
	// logo (agents) or fanned team-stack icon (teams). ActiveIcon is the same stable
	// component the picker rows use, so the trigger never drifts. Shown beside the
	// agent name on EVERY surface (compact and full), not just compact mode.
	const ActiveIcon = activeMode?.icon;
	let leading: React.ReactNode = null;
	if (activeAgent?.avatarUrl) {
		leading = (
			// biome-ignore lint/performance/noImgElement: Tauri/Vite app, no next/image; avatar is an inline data URL
			// biome-ignore lint/correctness/useImageSize: sized via the `size-4` class
			<img
				alt=""
				className="size-4 shrink-0 rounded-full object-cover"
				src={activeAgent.avatarUrl}
			/>
		);
	} else if (ActiveIcon) {
		leading = <ActiveIcon className="size-4 shrink-0" />;
	}

	// Compact trigger: `[logo] agent [usage] ⌄` — model/approval stay inside the
	// dropdown. Shared by the dense chat-with-history composer and the narrow-panel
	// (Ask Ryu) one; both keep the cluster left-aligned in the stacked controls row.
	const settingsMenu = (
		<ComposerSettingsMenu
			compact={compact || compactTrigger}
			footer={(close) => <ManageModelsButton close={close} />}
			leading={leading}
			renderBody={renderBody}
			sections={sections}
			trailing={
				compact || compactTrigger ? (
					<UsageBar agentId={agentId} className="ml-0.5" compact />
				) : undefined
			}
		/>
	);

	// ONE cluster, one place: the settings menu, the badges and (full trigger only)
	// the usage chip, left-aligned in the composer's stacked controls row. Compact
	// used to return a second arrangement here — cluster on the RIGHT, `leftActions`
	// null — which made the chat page and the launchpad two different composers
	// behind one flag. Compact is a density now, so there is nothing left to fork.
	const leftActions = (
		<div className="flex min-w-0 items-center gap-0.5">
			{settingsMenu}
			{/* Read-only capability badges (tools / thinking / vision) — local
			    models / flagship Ryu only; hidden for external ACP harnesses. */}
			{showCapabilityBadges && <CapabilityBadges capabilities={capabilities} />}
			{/* Only the FULL trigger shows usage as a standalone chip: both compact
			    modes already fold the same meters into the trigger's `trailing`, so
			    rendering the chip too would show every meter twice. */}
			{compact || compactTrigger ? null : <UsageBar agentId={agentId} />}
		</div>
	);

	return {
		infoBar,
		leftActions,
		refreshRoutingAdvice,
		rightActions: null,
		sections,
		renderBody,
	};
}
