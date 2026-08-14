// Interface level — how much of the app is on screen at all.
//
// Ryu ships two audiences in one binary: someone who wants a chat box, and
// someone who wants the model, the approval mode, the thinking budget and the
// raw tool transcript. Every one of those controls used to be unconditionally
// present, so the first audience met the second audience's cockpit on install.
// This is the one knob that decides which app they get, and it defaults to
// SIMPLE — the everyday, non-technical reading — because that is the larger
// audience and the one that cannot recover from a wrong default on their own.
//
// It is a stepped PRESET over prefs that already exist, exactly like the Detail
// level ladder it sits next to (`tool-detail-ladder.ts`): moving it WRITES the
// downstream prefs rather than shadowing them, so anything it turns on is still
// findable, nameable and reversible in Settings → Appearance. Two consequences
// worth stating out loud:
//
//   - Moving the slider overwrites a hand-tuned Detail level. Same trade the
//     Detail preset itself makes; the alternative is a level that claims to
//     simplify the app and then leaves the transcript exactly as it was.
//   - It is NEVER retro-applied on boot. `seedInterfaceLevel()` writes only keys
//     that have never been written, so an existing user's setup survives the
//     upgrade and only a fresh install gets the Simple treatment.
//
// What the level itself gates live (no write involved) is two surfaces:
//
//   - The composer: at Simple the chat bar offers the agent picker and nothing
//     else — no model, no approval mode, no thinking budget, no output style.
//     See `composer-agent-controls.tsx`.
//   - The node dropdown: at Simple the Engines, Voice & Sandbox and Toolkits
//     blocks start folded behind their own headings rather than listing flat.
//     See `NodeSelector.tsx`.

import { setPersistedToggle } from "@/src/hooks/usePersistedToggle.ts";
import { TOOL_DETAIL_PRESETS } from "@/src/lib/tool-detail-ladder.ts";

export const INTERFACE_LEVEL_KEY = "ryu:interface-level";

/** localStorage keys this preset writes. Owned elsewhere; only seeded here. */
const HIDE_TOOL_DETAIL_KEY = "ryu:hide-tool-detail";
const GROUP_TOOL_USES_KEY = "ryu:group-tool-uses";
const EXPAND_FILE_EDITS_KEY = "ryu:expand-file-edits";
const EXPAND_COMMANDS_KEY = "ryu:expand-commands";
const EXPAND_CODE_BLOCKS_KEY = "ryu:expand-code-blocks";
const INFERENCE_STATS_KEY = "ryu:inference-stats";

/**
 * The ladder, least → most surface. Ordered so the slider's fill ramp (cool →
 * hot, see `level-ramp.ts`) reads as "more of the app is showing".
 *
 * Deliberately NOT called "Minimal" at the bottom: the Detail level slider two
 * settings away uses "Minimal" as a MIDDLE value, and two nearby sliders meaning
 * different things by the same word is how a settings page stops being
 * readable.
 */
export const INTERFACE_LEVELS = [
	{
		id: "simple",
		label: "Simple",
		description: "Just chat. One picker, no model or mode controls.",
	},
	{
		id: "standard",
		label: "Standard",
		description: "Chat plus the model behind it.",
	},
	{
		id: "advanced",
		label: "Advanced",
		description: "Approval mode, thinking budget and output style too.",
	},
	{
		id: "expert",
		label: "Expert",
		description: "Everything, plus the full tool transcript and run stats.",
	},
] as const;

export type InterfaceLevel = (typeof INTERFACE_LEVELS)[number]["id"];

/** Everyday people, not developers — see the header. */
export const DEFAULT_INTERFACE_LEVEL: InterfaceLevel = "simple";

/** The transcript density each level implies, applied when the level moves. */
const LEVEL_TOOL_DETAIL: Record<
	InterfaceLevel,
	{ hidden: boolean; preset: keyof typeof TOOL_DETAIL_PRESETS }
> = {
	// `preset` is still carried at Simple even though nothing is shown: stepping
	// back up must land somewhere sane rather than on whatever was last stored.
	simple: { hidden: true, preset: "compact" },
	standard: { hidden: false, preset: "compact" },
	advanced: { hidden: false, preset: "minimal" },
	expert: { hidden: false, preset: "detailed" },
};

function isLevel(value: string | null): value is InterfaceLevel {
	return INTERFACE_LEVELS.some((l) => l.id === value);
}

const listeners = new Set<() => void>();

function readFromStorage(): InterfaceLevel {
	try {
		const raw = localStorage.getItem(INTERFACE_LEVEL_KEY);
		return isLevel(raw) ? raw : DEFAULT_INTERFACE_LEVEL;
	} catch {
		return DEFAULT_INTERFACE_LEVEL;
	}
}

let cache: InterfaceLevel = readFromStorage();

/** The current level without subscribing (module scope, event handlers). */
export function readInterfaceLevel(): InterfaceLevel {
	return cache;
}

export function getInterfaceLevelSnapshot(): InterfaceLevel {
	return cache;
}

export function getInterfaceLevelServerSnapshot(): InterfaceLevel {
	return DEFAULT_INTERFACE_LEVEL;
}

export function subscribeInterfaceLevel(cb: () => void): () => void {
	listeners.add(cb);
	const onStorage = (e: StorageEvent) => {
		if (e.key === INTERFACE_LEVEL_KEY) {
			cache = readFromStorage();
			cb();
		}
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(cb);
		window.removeEventListener("storage", onStorage);
	};
}

/** Write the downstream transcript prefs a level implies. */
function applyLevelPrefs(level: InterfaceLevel): void {
	const { hidden, preset } = LEVEL_TOOL_DETAIL[level];
	const detail = TOOL_DETAIL_PRESETS[preset];
	setPersistedToggle(HIDE_TOOL_DETAIL_KEY, hidden);
	setPersistedToggle(GROUP_TOOL_USES_KEY, detail.group);
	setPersistedToggle(EXPAND_FILE_EDITS_KEY, detail.edits);
	setPersistedToggle(EXPAND_COMMANDS_KEY, detail.commands);
	setPersistedToggle(EXPAND_CODE_BLOCKS_KEY, detail.code);
	// Per-turn token/latency readouts are an Expert affordance; every other level
	// turns them back off, so stepping down actually simplifies the transcript.
	setPersistedToggle(INFERENCE_STATS_KEY, level === "expert");
}

/**
 * Persist the level, apply what it implies, and notify every consumer.
 *
 * `applyPrefs: false` writes the level alone. Exactly one caller wants that:
 * Appearance's "Reset to defaults", where every downstream pref already has its
 * own registered reset — writing them from here too would make the outcome
 * depend on which entry ran last.
 */
export function setInterfaceLevel(
	level: InterfaceLevel,
	{ applyPrefs = true }: { applyPrefs?: boolean } = {}
): void {
	cache = level;
	try {
		localStorage.setItem(INTERFACE_LEVEL_KEY, level);
	} catch {
		// Best-effort persistence; in-memory state still updates.
	}
	if (applyPrefs) {
		applyLevelPrefs(level);
	}
	for (const cb of listeners) {
		cb();
	}
}

/**
 * First-run seeding: give a fresh install the Simple transcript without ever
 * rewriting a pref the user has already set.
 *
 * Runs once, on import. Only keys with NO stored value are written — an upgrade
 * from a build that predates this ladder keeps every toggle the user touched,
 * and only the ones they never touched pick up the Simple default. Also
 * deliberately does not write `INTERFACE_LEVEL_KEY` itself: an absent key
 * already reads as Simple, and leaving it absent keeps "has this user ever
 * chosen a level?" answerable.
 */
export function seedInterfaceLevel(): void {
	let stored: string | null;
	try {
		stored = localStorage.getItem(INTERFACE_LEVEL_KEY);
	} catch {
		return;
	}
	if (stored !== null) {
		return;
	}
	const { hidden, preset } = LEVEL_TOOL_DETAIL[DEFAULT_INTERFACE_LEVEL];
	const detail = TOOL_DETAIL_PRESETS[preset];
	const seeds: [string, boolean][] = [
		[HIDE_TOOL_DETAIL_KEY, hidden],
		[GROUP_TOOL_USES_KEY, detail.group],
		[EXPAND_FILE_EDITS_KEY, detail.edits],
		[EXPAND_COMMANDS_KEY, detail.commands],
		[EXPAND_CODE_BLOCKS_KEY, detail.code],
	];
	for (const [key, value] of seeds) {
		try {
			if (localStorage.getItem(key) === null) {
				setPersistedToggle(key, value);
			}
		} catch {
			// Best-effort; a blocked storage just leaves the shipped default.
		}
	}
}

/** Where the slider thumb sits for a level. */
export function interfaceLevelIndex(level: InterfaceLevel): number {
	const index = INTERFACE_LEVELS.findIndex((l) => l.id === level);
	return index === -1 ? 0 : index;
}

/** Does this level put the model picker in the composer? */
export function showsModelPicker(level: InterfaceLevel): boolean {
	return level !== "simple";
}

/**
 * Does this level show the composer's tuning sections — approval mode, thinking
 * budget, agent-advertised config options, output style?
 *
 * Simple and Standard hide them. Hiding is not disabling: the agent still runs
 * on whatever approval mode is configured, it simply is not surfaced in the chat
 * bar. Someone who needs to SEE which mode they are in raises the level.
 */
export function showsComposerTuning(level: InterfaceLevel): boolean {
	return level === "advanced" || level === "expert";
}

/**
 * Does this level fold the node dropdown's technical blocks — Engines, Voice &
 * Sandbox, Toolkits — behind a disclosure?
 *
 * Simple folds them; every level above lists them flat, exactly as before. Same
 * trade as the composer gates above, one notch softer: collapsing is not even
 * hiding. The heading stays on screen, the block is one click away, and every
 * row inside it still works — so someone who manages engines from this menu
 * raises the level once and never meets the disclosure again, and someone who
 * does not gets a node menu about the node (who it is, what it costs, what is
 * connected) instead of three blocks of runtime plumbing.
 */
export function collapsesNodeSections(level: InterfaceLevel): boolean {
	return level === "simple";
}

seedInterfaceLevel();
