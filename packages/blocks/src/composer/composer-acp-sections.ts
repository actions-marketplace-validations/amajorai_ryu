"use client";

// The ONE derivation of a composer's ACP-driven picker sections — the Model
// selector plus the Approval (permission mode) and agent-advertised config
// selectors — from an agent's advertised session config.
//
// Every surface that renders a composer feeds the returned `modelSection` /
// `extraSections` into its own `ComposerSettingsMenu`, so desktop and the island
// show the SAME Agent · Model · Approval · Thinking pickers, derived by the same
// rules, from the same per-agent persisted selections.
//
// What lives HERE is everything that is genuinely common: the label/approval
// classification, the dedup rules (a `category:"mode"`/`"model"` config option
// supersedes the generic picker; a modes set duplicated by a config option is
// hidden; reasoning-off suppresses the thinking picker), the
// `acpMode`/`acpModel`/`acpOptionValues` state machine with its per-agent
// seeding and reset, and — the part that used to exist on ONE surface only —
// adoption of both agent-initiated write-back channels Core streams
// (`data-ryu-acp-mode` and `data-ryu-acp-config`).
//
// What stays in the app is anything surface-specific: how selections are
// persisted (injected as an {@link AcpSelectionStore}), how model rows are named
// and filtered (injected as `modelDisplayName` / `filterModelItems`), and any
// extra chrome layered on the returned model section (a grouped/searchable
// submenu, a loading state).
//
// The state machine is deliberately split into exported pure units
// ({@link seedAcpSelections}, {@link shouldAdoptStreamedConfig},
// {@link mergeStreamedConfig}, {@link persistStreamedConfig}) so the two rules
// that are easiest to get subtly wrong — emission-identity dedupe and per-agent
// isolation — are directly testable without a React renderer.

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { approvalModeStyle } from "./composer-approval-style.ts";
import type {
	ComposerSettingItem,
	ComposerSettingsSection,
} from "./composer-settings-menu.tsx";
import type { ModelOption } from "./types.ts";

// ── The ACP shapes this derivation reads ─────────────────────────────────────
//
// Structural, and deliberately minimal: each surface has its own fuller client
// type (Core's `/acp-config` response), and those assign to these directly.

/** One selectable value for a `select` config option. */
export interface AcpConfigSelectOption {
	description?: string | null;
	name: string;
	value: string;
}

/**
 * A session config option. The common case (and the only `type` a picker is
 * rendered for) is `"select"` — a dropdown with `currentValue` + `options`.
 * `category` is a UX hint: `"mode"` | `"model"` | `"thoughtLevel"` (reasoning
 * effort) | any agent-defined string.
 */
export interface AcpConfigOption {
	category?: string | null;
	currentValue?: string;
	description?: string | null;
	id: string;
	name: string;
	/** Flat list for ungrouped selects; grouped selects expose `{ options }`. */
	options?: AcpConfigSelectOption[] | { options: AcpConfigSelectOption[] }[];
	type?: string;
}

/** The agent-advertised model set + the model currently active. */
export interface AcpSessionModelState {
	availableModels: {
		description?: string | null;
		modelId: string;
		name: string;
	}[];
	currentModelId: string;
}

/** The agent-advertised permission-mode set + the mode currently active. */
export interface AcpSessionModeState {
	availableModes: { description?: string | null; id: string; name: string }[];
	currentModeId: string;
}

/** The subset of an agent's advertised session config the composer reads. */
export interface AcpSessionConfig {
	configOptions: AcpConfigOption[] | null;
	models: AcpSessionModelState | null;
	modes: AcpSessionModeState | null;
}

/** The subset of an agent registry row this derivation reads. */
export interface AcpAgentRef {
	id: string;
	transport?: string | null;
}

/** Flatten a select option's `options` (ungrouped or grouped) to a flat list. */
export function flattenConfigOptions(
	option: AcpConfigOption
): AcpConfigSelectOption[] {
	const raw = option.options ?? [];
	const first = raw[0];
	if (!first) {
		return [];
	}
	// Grouped form: `[{ options: [...] }, ...]`.
	if ("options" in first) {
		return (raw as { options: AcpConfigSelectOption[] }[]).flatMap(
			(g) => g.options
		);
	}
	return raw as AcpConfigSelectOption[];
}

// ── Persistence seam ─────────────────────────────────────────────────────────

/**
 * Per-agent persistence of the user's ACP session-control choices. Each surface
 * supplies its own (both currently back onto `localStorage`), so this module
 * never reaches for a storage API of its own — which is also what makes the
 * state machine testable against an in-memory fake.
 */
export interface AcpSelectionStore {
	getAcpConfig(agentId: string | null): Record<string, string>;
	getAcpMode(agentId: string | null): string | null;
	getAcpModel(agentId: string | null): string | null;
	setAcpConfigValue(agentId: string, configId: string, valueId: string): void;
	setAcpMode(agentId: string, modeId: string): void;
	setAcpModel(agentId: string, modelId: string): void;
}

/** The three per-agent selections, as seeded from the store on an agent switch. */
export interface AcpSelections {
	mode: string | null;
	model: string | null;
	options: Record<string, string>;
}

/** Read an agent's persisted selections. `null`/`{}` for an agent with none. */
export function seedAcpSelections(
	store: AcpSelectionStore,
	agentId: string | null
): AcpSelections {
	return {
		mode: store.getAcpMode(agentId),
		model: store.getAcpModel(agentId),
		options: store.getAcpConfig(agentId),
	};
}

// ── Streamed write-back (`data-ryu-acp-config`) ──────────────────────────────

/**
 * One agent-requested session-config write-back, tagged with the identity of the
 * stream part that carried it (e.g. `messageId:partIndex`). The key — not the
 * value — is what both the producer and this hook dedupe on: an agent re-emits
 * the byte-identical map on every cycle (`ExitPlanMode` always writes
 * `{"ryu.plan":"off"}`), so a value-keyed guard would adopt only the first one
 * and silently drop every repeat.
 */
export interface StreamedAcpConfig {
	/** configId → valueId pairs to adopt and persist. */
	config: Record<string, string>;
	/** Emission identity of the part that carried this map. */
	key: string;
}

/**
 * Whether a streamed write-back should be adopted, given the emission key of the
 * last one adopted. Keying on the PART means a re-render (the producer re-derives
 * a fresh object with identical contents on every stream chunk) never re-adopts,
 * while a genuinely new emission carrying the same pairs always does.
 */
export function shouldAdoptStreamedConfig(
	streamed: StreamedAcpConfig | null | undefined,
	lastAdoptedKey: string | null
): streamed is StreamedAcpConfig {
	return Boolean(streamed) && streamed?.key !== lastAdoptedKey;
}

/**
 * MERGE the requested pairs over the current selections — never replace the map,
 * which also carries every other advertised option (thought level, …).
 */
export function mergeStreamedConfig(
	previous: Record<string, string>,
	config: Record<string, string>
): Record<string, string> {
	return { ...previous, ...config };
}

/**
 * Persist each written-back pair for `agentId`, exactly as a user's own pick
 * would be — so the NEXT turn's request body sends the new value. A null agent
 * (nothing selected) writes nothing.
 */
export function persistStreamedConfig(
	store: AcpSelectionStore,
	agentId: string | null,
	config: Record<string, string>
): void {
	if (!agentId) {
		return;
	}
	for (const [configId, valueId] of Object.entries(config)) {
		store.setAcpConfigValue(agentId, configId, valueId);
	}
}

// ── Section builders ─────────────────────────────────────────────────────────

/**
 * Strip a redundant "Option:" prefix a value name may repeat (Pi reports
 * "Thinking: off", …) and capitalize, so a row reads "Off" not "Thinking: off".
 */
export function formatAcpOptionLabel(
	optionName: string,
	valueName: string
): string {
	let label = valueName.trim();
	const prefix = `${optionName.trim()}:`;
	if (label.toLowerCase().startsWith(prefix.toLowerCase())) {
		label = label.slice(prefix.length).trim();
	}
	return label.length > 0
		? label.charAt(0).toUpperCase() + label.slice(1)
		: label;
}

/**
 * Announce a session-control pick the USER just made, so a surface can tell them
 * when it takes effect. Called with human labels ("Approval", "Bypass
 * permissions"), never ids, and ONLY from the picker `onChange` seams — an
 * agent-initiated write-back (`data-ryu-acp-mode` / `data-ryu-acp-config`) runs
 * through the same setters but must not be announced as the user's own change.
 */
export type AcpSelectionNotify = (setting: string, value: string) => void;

/**
 * A config option that carries the agent's approval/permission presets (Codex
 * exposes them as `category: "mode"` rather than the dedicated ACP `modes` set).
 * These get the same CLI-style icon+colour treatment as the Approval section via
 * `approvalModeStyle`; every other option (reasoning effort, verbosity, …) stays
 * plain. Classified by the semantic hint, NOT by agent, so nothing is hardcoded.
 */
export function isApprovalConfigOption(opt: AcpConfigOption): boolean {
	if (opt.category === "mode") {
		return true;
	}
	const hay = `${opt.id} ${opt.name}`.toLowerCase();
	return ["approval", "permission", "sandbox", "access"].some((k) =>
		hay.includes(k)
	);
}

/**
 * A config option that carries reasoning effort ("thought level", "thinking",
 * "reasoning effort", …). Suppressed when the agent's reasoning is overridden
 * off. Classified by the semantic hint, like the approval check above.
 */
export function isReasoningOption(opt: AcpConfigOption): boolean {
	const hay = `${opt.category ?? ""} ${opt.id} ${opt.name}`.toLowerCase();
	return ["thought", "reason", "think", "effort"].some((m) => hay.includes(m));
}

/**
 * Build the picker section for one agent-advertised `select` config option.
 * Approval/permission options (Codex's Read Only / Auto / Full Access, …) get
 * the same CLI-style icon+colour the Approval section gets; all others stay plain.
 */
export function buildConfigOptionSection(
	opt: AcpConfigOption,
	acpOptionValues: Record<string, string>,
	onChange: (configId: string, valueId: string) => void,
	/** Announce a USER pick (never a streamed write-back). Optional. */
	notify?: AcpSelectionNotify
): ComposerSettingsSection {
	const items = flattenConfigOptions(opt).map((o) => ({
		id: o.value,
		name: formatAcpOptionLabel(opt.name, o.name),
		description: o.description,
	}));
	const current = acpOptionValues[opt.id] ?? opt.currentValue;
	return {
		key: `cfg-${opt.id}`,
		label: opt.name,
		ariaLabel: opt.name,
		decorate: isApprovalConfigOption(opt) ? approvalModeStyle : undefined,
		items,
		value: current,
		onChange: (valueId: string) => {
			onChange(opt.id, valueId);
			// Re-picking what is already active changes nothing to announce.
			if (valueId !== current) {
				notify?.(
					opt.name,
					items.find((i) => i.id === valueId)?.name ?? valueId
				);
			}
		},
		// Reasoning effort is the one ordered scale an agent advertises (off →
		// low → … → max), so it reads as a slider rather than a checked list. The
		// detents ARE the agent's own values: Pi ships an `off` level, Codex does
		// not, and a hardcoded low→xhigh ladder would desync from both.
		variant: isReasoningOption(opt) ? "slider" : undefined,
	};
}

/**
 * A caller-supplied override for the composer's Model section — the ACP-models /
 * config-option / engine-catalog chain resolved below.
 */
export interface ComposerModelSection {
	items: ComposerSettingItem[];
	/** The agent's model surface is still being probed (ACP capability fetch in flight). */
	loading?: boolean;
	onChange: (id: string) => void;
	/** Grouped/searchable body; when set, overrides the flat item list. */
	renderContent?: (onSelect: (id: string) => void) => ReactNode;
	value: string | undefined;
}

/** Map a model's raw name for display (e.g. friendly mode). Identity by default. */
export type ModelDisplayName = (raw: string) => string;

/**
 * Narrow one model branch's rows (e.g. a surface's per-model visibility
 * overrides). `current` is that BRANCH's active selection and must always
 * survive filtering, so a hidden-but-selected model is never dropped from under
 * the user. Identity by default.
 */
export type FilterModelItems = (
	items: ComposerSettingItem[],
	current: string | null | undefined
) => ComposerSettingItem[];

export interface ModelSectionParams {
	acpModelConfigOption: AcpConfigOption | undefined;
	acpOptionValues: Record<string, string>;
	acpSessionConfig: AcpSessionConfig | null | undefined;
	activeAgentIsAcp: boolean;
	effectiveAcpModel: string | null;
	engineModel: string | null;
	filterModelItems: FilterModelItems;
	hasDedicatedAcpModels: boolean;
	modelDisplayName: ModelDisplayName;
	modelOptions: ModelOption[];
	/**
	 * Announce a user model pick. Wired on BOTH ACP branches: the flagship pi-acp
	 * has no `session/set_model` and advertises its models as a `category:"model"`
	 * config option, so the config-option branch — not the dedicated one — is the
	 * common path. The engine-catalog fallback is deliberately left silent: it is
	 * the surface's own model setting, not an agent-advertised session control.
	 */
	notify?: AcpSelectionNotify;
	onAcpModelChange: (id: string) => void;
	onAcpOptionChange: (configId: string, valueId: string) => void;
	onEngineModelChange: (id: string) => void;
}

/**
 * Resolve the Model picker via the priority chain: dedicated ACP `models` → a
 * `category:"model"` config option → the surface's built-in engine catalog (only
 * when the active agent is not an ACP agent). Returns an empty section (no
 * picker) when an ACP agent advertises no model surface.
 */
export function buildModelSection(
	params: ModelSectionParams
): ComposerModelSection {
	const {
		acpModelConfigOption,
		acpOptionValues,
		acpSessionConfig,
		activeAgentIsAcp,
		effectiveAcpModel,
		engineModel,
		filterModelItems,
		hasDedicatedAcpModels,
		modelDisplayName,
		modelOptions,
		notify,
		onAcpModelChange,
		onAcpOptionChange,
		onEngineModelChange,
	} = params;

	if (hasDedicatedAcpModels && acpSessionConfig?.models) {
		const items = filterModelItems(
			acpSessionConfig.models.availableModels.map((m) => ({
				id: m.modelId,
				name: modelDisplayName(m.name),
			})),
			effectiveAcpModel
		);
		return {
			items,
			value: effectiveAcpModel ?? undefined,
			onChange: (modelId: string) => {
				onAcpModelChange(modelId);
				if (modelId !== effectiveAcpModel) {
					notify?.(
						"Model",
						items.find((i) => i.id === modelId)?.name ?? modelId
					);
				}
			},
		};
	}
	if (acpModelConfigOption) {
		const opt = acpModelConfigOption;
		const current = acpOptionValues[opt.id] ?? opt.currentValue;
		const items = filterModelItems(
			flattenConfigOptions(opt).map((o) => ({
				id: o.value,
				name: modelDisplayName(o.name),
				description: o.description,
			})),
			current
		);
		return {
			items,
			value: current,
			onChange: (valueId: string) => {
				onAcpOptionChange(opt.id, valueId);
				if (valueId !== current) {
					notify?.(
						"Model",
						items.find((i) => i.id === valueId)?.name ?? valueId
					);
				}
			},
		};
	}
	if (!activeAgentIsAcp) {
		return {
			items: filterModelItems(
				modelOptions.map((m) => ({
					id: m.id,
					name: modelDisplayName(m.name),
				})),
				engineModel
			),
			value: engineModel ?? undefined,
			onChange: onEngineModelChange,
		};
	}
	return { items: [], value: undefined, onChange: () => undefined };
}

// ── Visibility derivation ────────────────────────────────────────────────────

/** Which advertised pickers survive the dedup + reasoning-off rules. */
export interface VisibleAcpOptions {
	/** The `category:"model"` option that owns the Model picker, if any. */
	acpModelConfigOption: AcpConfigOption | undefined;
	/** True when a config option owns the permission setting instead of `modes`. */
	hideAcpModesPicker: boolean;
	/** Config options that get their own section (model option + hidden ones removed). */
	visibleAcpConfigOptions: AcpConfigOption[];
}

/**
 * Apply the two dedup rules and the reasoning-off suppression:
 *  - a `category:"mode"` config option supersedes the dedicated `modes` picker;
 *  - some agents advertise reasoning effort as BOTH a `modes` set AND a config
 *    option with an identical value set — hide the redundant modes picker in
 *    favour of the config option (which carries a stable category/id);
 *  - a `category:"model"` option drives the Model picker, never its own section;
 *  - when the agent's reasoning is overridden off, its reasoning option is hidden.
 */
export function deriveVisibleAcpOptions(
	acpSessionConfig: AcpSessionConfig | null | undefined,
	reasoningOff: boolean
): VisibleAcpOptions {
	const acpConfigOptions = acpSessionConfig?.configOptions ?? [];

	const acpModeIds = (acpSessionConfig?.modes?.availableModes ?? [])
		.map((m) => m.id)
		.sort()
		.join(",");
	const modesDuplicatedByConfigOption =
		acpModeIds.length > 0 &&
		acpConfigOptions.some(
			(opt) =>
				opt.category !== "model" &&
				flattenConfigOptions(opt)
					.map((o) => o.value)
					.sort()
					.join(",") === acpModeIds
		);

	return {
		acpModelConfigOption: acpConfigOptions.find(
			(opt) => opt.category === "model"
		),
		hideAcpModesPicker:
			acpConfigOptions.some((opt) => opt.category === "mode") ||
			modesDuplicatedByConfigOption,
		visibleAcpConfigOptions: acpConfigOptions.filter(
			(opt) =>
				opt.category !== "model" && !(reasoningOff && isReasoningOption(opt))
		),
	};
}

// ── The hook ─────────────────────────────────────────────────────────────────

export interface AcpSectionsParams {
	/**
	 * The active agent's advertised session config (permission modes / config
	 * options / models). Null or undefined while unknown or for a non-ACP agent.
	 */
	acpSessionConfig: AcpSessionConfig | null | undefined;
	/** The active agent (drives the advertised config + persistence key). */
	agentId: string | null;
	/** Live agent registry — used only to detect the active agent's transport. */
	agents: AcpAgentRef[];
	/** Effective engine model id (for the non-ACP fallback picker). */
	engineModel: string | null;
	/** Narrow each model branch's rows. Identity when omitted. */
	filterModelItems?: FilterModelItems;
	/** Map a model's display name. Identity when omitted. */
	modelDisplayName?: ModelDisplayName;
	/** Engine-catalog model options — the fallback picker for non-ACP agents. */
	modelOptions: ModelOption[];
	/** Persist an engine-catalog model pick (non-ACP fallback). */
	onEngineModelChange: (modelId: string) => void;
	/**
	 * Called with human labels when the USER picks a session control here, so a
	 * chat surface can say when it takes effect: the picks are sticky and ride the
	 * NEXT turn's request body (Core re-applies them per turn via
	 * `set_mode`/`set_config_option`/`set_model`), so nothing about the reply on
	 * screen changes. Fired from the picker seams only — an agent-initiated
	 * write-back drives the same state through the streamed-adoption effects and is
	 * deliberately silent. Surfaces with no turn to apply to (a submenu for a
	 * non-active agent) simply omit it. Need not be referentially stable.
	 */
	onSelectionApplied?: AcpSelectionNotify;
	/**
	 * The active agent's reasoning is overridden off — suppress its reasoning
	 * ("thinking") config option. Defaults to false: an agent that advertises a
	 * reasoning picker gets one unless the surface knows reasoning is disabled.
	 */
	reasoningOff?: boolean;
	/** Per-agent persistence of the three selections. Must be referentially stable. */
	store: AcpSelectionStore;
	/**
	 * Session-config values the AGENT asked the client to update, observed on the
	 * live chat stream (Core's `data-ryu-acp-config` part). Each pair is adopted
	 * into the option state and persisted for the agent, exactly as a user's own
	 * pick would be — so the NEXT turn sends the new value.
	 *
	 * This exists because the picks here are STICKY: `acpOptionValues` is seeded
	 * from the store and re-sent every turn, so an agent-side action that
	 * invalidates a pick (approving an exit from the mode the pick turns on) would
	 * otherwise be undone by the next message. Surfaces with no live stream
	 * (launchpad/dock) leave this undefined.
	 */
	streamedConfig?: StreamedAcpConfig | null;
	/**
	 * An agent-INITIATED permission-mode change observed on the live chat stream
	 * (Core's `data-ryu-acp-mode` part). When this value changes to a new non-null
	 * mode id, it is adopted as the Approval picker's selection and persisted for
	 * the agent — so the composer reflects a mode the agent switched to on its own,
	 * not just the user's own clicks. Surfaces with no live stream leave it undefined.
	 */
	streamedMode?: string | null;
}

export interface AcpSectionsResult {
	/**
	 * Effective permission mode for the request body — null when the dedicated
	 * modes picker is hidden (a config option owns that setting instead).
	 */
	acpMode: string | null;
	/** Effective model id for the request body. */
	acpModel: string | null;
	/** Effective agent-config selections for the request body. */
	acpOptionValues: Record<string, string>;
	/** Whether the active agent runs over the ACP transport. */
	activeAgentIsAcp: boolean;
	/** Approval (permission mode) + agent-advertised config sections. */
	extraSections: ComposerSettingsSection[];
	/** The agent-advertised (or engine-fallback) Model section. Empty items → hidden. */
	modelSection: ComposerModelSection;
}

const IDENTITY_DISPLAY_NAME: ModelDisplayName = (raw) => raw;
const KEEP_ALL_MODELS: FilterModelItems = (items) => items;

/**
 * Builds a composer's Model + Approval + config picker sections from the active
 * agent's advertised ACP session config, owning the per-agent selection state.
 * Session-independent (works before any chat exists); picks persist per-agent
 * through the injected {@link AcpSelectionStore}.
 */
export function useAcpSections({
	acpSessionConfig,
	agentId,
	agents,
	engineModel,
	filterModelItems = KEEP_ALL_MODELS,
	modelDisplayName = IDENTITY_DISPLAY_NAME,
	modelOptions,
	onEngineModelChange,
	onSelectionApplied,
	reasoningOff = false,
	store,
	streamedConfig,
	streamedMode,
}: AcpSectionsParams): AcpSectionsResult {
	const [acpMode, setAcpMode] = useState<string | null>(() =>
		store.getAcpMode(agentId)
	);
	const [acpModel, setAcpModel] = useState<string | null>(() =>
		store.getAcpModel(agentId)
	);
	const [acpOptionValues, setAcpOptionValues] = useState<
		Record<string, string>
	>(() => store.getAcpConfig(agentId));

	// Tracks the last streamed mode we adopted, so a repeated identical event
	// (same value re-emitted) doesn't clobber a user's subsequent manual pick.
	const lastStreamedModeRef = useRef<string | null>(null);
	// Same guard for the config write-back, but holding the EMISSION key of the
	// part we adopted rather than its value: the caller re-derives the map from the
	// message list on every stream chunk (fresh object, identical contents), and an
	// agent re-emits the same pairs on every cycle. Keying on the part means a
	// re-render never re-adopts, and a genuinely new write-back always does.
	const lastStreamedConfigRef = useRef<string | null>(null);
	// The agent the write-back below should be applied to, read through a ref so
	// `agentId` need not be an effect dep — see that effect for why.
	const agentIdRef = useRef(agentId);
	// The pick announcer, held in a ref so a caller passing an inline arrow never
	// re-identifies the sections memo (which every composer's settings menu reads).
	const notifyRef = useRef(onSelectionApplied);
	notifyRef.current = onSelectionApplied;
	const notify = useCallback<AcpSelectionNotify>((setting, value) => {
		notifyRef.current?.(setting, value);
	}, []);

	// Reset selections to the new agent's persisted choices when it changes.
	useEffect(() => {
		agentIdRef.current = agentId;
		const seeded = seedAcpSelections(store, agentId);
		setAcpMode(seeded.mode);
		setAcpModel(seeded.model);
		setAcpOptionValues(seeded.options);
		// A streamed mode belongs to the previous agent's session; forget it, or the
		// old agent's write-back would land on the new one.
		lastStreamedModeRef.current = null;
		// `lastStreamedConfigRef` is deliberately NOT cleared. It holds a per-part
		// emission key, unique for the life of the conversation, so it can never go
		// stale — while clearing it is precisely what would let the previous agent's
		// write-back re-apply (the caller keeps the last one around; it only ever
		// sets that state, never clears it), overwriting the pick the user just made
		// for whichever agent is now selected.
	}, [agentId, store]);

	// Adopt an agent-initiated mode switch (Core's `data-ryu-acp-mode`): sync the
	// Approval picker's selection and persist it, mirroring a user click.
	useEffect(() => {
		if (!streamedMode || streamedMode === lastStreamedModeRef.current) {
			return;
		}
		lastStreamedModeRef.current = streamedMode;
		setAcpMode(streamedMode);
		if (agentId) {
			store.setAcpMode(agentId, streamedMode);
		}
	}, [streamedMode, agentId, store]);

	// Adopt an agent-requested config write-back (Core's `data-ryu-acp-config`):
	// MERGE the requested pairs over the current selections — never replace the
	// map, which also carries every other advertised option (thought_level, …) —
	// and persist each one, so the next turn's request body sends the new value.
	//
	// A write-back is LIVE-STREAM ONLY, which is what keeps this from fighting the
	// user: Core's `PartsAccumulator` seals text/tool/file parts into the `parts`
	// column and drops `data-*` ones, so a reloaded conversation carries no
	// `data-ryu-acp-config` to re-adopt. The value survives as the persisted
	// selection it wrote, not as a replayed instruction — so re-arming the pill and
	// reloading keeps it armed. Same property the mode sync above relies on.
	//
	// `agentId` is read from a ref rather than listed as a dep on purpose: the
	// caller never clears `streamedConfig`, so an agentId dep would re-fire this on
	// every agent switch and persist the previous agent's write-back onto the newly
	// selected one — clobbering the pick the reset effect above just restored.
	useEffect(() => {
		if (
			!shouldAdoptStreamedConfig(streamedConfig, lastStreamedConfigRef.current)
		) {
			return;
		}
		lastStreamedConfigRef.current = streamedConfig.key;
		const { config } = streamedConfig;
		setAcpOptionValues((prev) => mergeStreamedConfig(prev, config));
		persistStreamedConfig(store, agentIdRef.current, config);
	}, [streamedConfig, store]);

	const handleAcpModeChange = useCallback(
		(modeId: string) => {
			setAcpMode(modeId);
			if (agentId) {
				store.setAcpMode(agentId, modeId);
			}
		},
		[agentId, store]
	);
	const handleAcpModelChange = useCallback(
		(modelId: string) => {
			setAcpModel(modelId);
			if (agentId) {
				store.setAcpModel(agentId, modelId);
			}
		},
		[agentId, store]
	);
	const handleAcpOptionChange = useCallback(
		(configId: string, valueId: string) => {
			setAcpOptionValues((prev) => ({ ...prev, [configId]: valueId }));
			if (agentId) {
				store.setAcpConfigValue(agentId, configId, valueId);
			}
		},
		[agentId, store]
	);

	return useMemo<AcpSectionsResult>(() => {
		const effectiveAcpMode =
			acpMode ?? acpSessionConfig?.modes?.currentModeId ?? null;
		const effectiveAcpModel =
			acpModel ?? acpSessionConfig?.models?.currentModelId ?? null;

		const hasDedicatedAcpModels = Boolean(
			acpSessionConfig?.models &&
				acpSessionConfig.models.availableModels.length > 0
		);
		const activeAgentIsAcp =
			agents.find((a) => a.id === agentId)?.transport === "acp";

		const {
			acpModelConfigOption,
			hideAcpModesPicker,
			visibleAcpConfigOptions,
		} = deriveVisibleAcpOptions(acpSessionConfig, reasoningOff);

		const modelSection = buildModelSection({
			acpModelConfigOption,
			acpOptionValues,
			acpSessionConfig,
			activeAgentIsAcp,
			effectiveAcpModel,
			engineModel,
			filterModelItems,
			hasDedicatedAcpModels,
			modelDisplayName,
			modelOptions,
			notify,
			onAcpModelChange: handleAcpModelChange,
			onAcpOptionChange: handleAcpOptionChange,
			onEngineModelChange,
		});

		const modeItems =
			!hideAcpModesPicker && acpSessionConfig?.modes
				? acpSessionConfig.modes.availableModes.map((m) => ({
						id: m.id,
						name: m.name,
						description: m.description,
					}))
				: [];
		const extraSections: ComposerSettingsSection[] = [
			{
				key: "approval",
				label: "Approval",
				ariaLabel: "Permission mode",
				decorate: approvalModeStyle,
				items: modeItems,
				value: effectiveAcpMode ?? acpSessionConfig?.modes?.currentModeId,
				onChange: (modeId: string) => {
					handleAcpModeChange(modeId);
					if (modeId !== effectiveAcpMode) {
						notify(
							"Approval",
							modeItems.find((m) => m.id === modeId)?.name ?? modeId
						);
					}
				},
			},
			...visibleAcpConfigOptions.map((opt) =>
				buildConfigOptionSection(
					opt,
					acpOptionValues,
					handleAcpOptionChange,
					notify
				)
			),
		];

		return {
			modelSection,
			extraSections,
			activeAgentIsAcp,
			// The request body drops acp_mode when the dedicated picker is hidden —
			// a config option owns that setting and a stale set_mode would race it.
			acpMode: hideAcpModesPicker ? null : effectiveAcpMode,
			acpModel: effectiveAcpModel,
			acpOptionValues,
		};
	}, [
		agentId,
		agents,
		acpSessionConfig,
		acpMode,
		acpModel,
		acpOptionValues,
		engineModel,
		filterModelItems,
		modelDisplayName,
		modelOptions,
		notify,
		onEngineModelChange,
		reasoningOff,
		handleAcpModeChange,
		handleAcpModelChange,
		handleAcpOptionChange,
	]);
}
