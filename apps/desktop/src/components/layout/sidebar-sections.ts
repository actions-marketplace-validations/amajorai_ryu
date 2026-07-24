// apps/desktop/src/components/layout/sidebar-sections.ts
//
// The sidebar's SECTION VOCABULARY — the one place the shell describes its own
// top-level sections — plus the order-persistence logic that reconciles a user's
// saved layout against it.
//
// Why this is a module and not four parallel tables inside AppSidebar.tsx: a
// section used to be spelled out five times (a closed `BuiltinSectionKey` union,
// `DEFAULT_SECTION_ORDER`, a label record, an icon record, and the tab-strip icon
// record derived from it). Five copies is how a section ends up in the order with
// no label, or labelled but never rendered. Here there is exactly ONE list —
// `BUILTIN_SECTIONS` — and the union, the default order, the labels and the icons
// are all derived from it, so adding or retiring a built-in section is a single
// entry and the compiler still proves every section has a label + a glyph.
//
// What is deliberately NOT here: apps. A Ryu App does not get an entry in this
// list — it contributes `sidebar_sections`, which the shell mints into a
// `plugin:<pluginId>:<sectionId>` {@link DynamicSectionKey} it has never heard of
// and renders generically. That is the open half of the vocabulary; this list is
// the closed half, and it is closed on purpose: these are the shell's own pages
// (Tabs, Chats, Pinned, Archived, …), they ship compiled in, and enumerating them
// is what lets `SECTION_LABELS`/`SECTION_ICONS` be exhaustive records rather than
// lookups that can miss. The rule for a reviewer: if a new section needs a Core
// app to exist, it belongs in that app's manifest, not in `BUILTIN_SECTIONS`.

import {
	Archive01Icon,
	BookOpen01Icon,
	BubbleChatIcon,
	ConnectIcon,
	CpuIcon,
	DeliverySecure01Icon,
	FolderOpenIcon,
	GridIcon,
	Key01Icon,
	Mortarboard01Icon,
	PinIcon,
	PuzzleIcon,
	ServerStack01Icon,
	Target01Icon,
	UserGroupIcon,
	WorkflowCircle06Icon,
	Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

/** localStorage key holding the user's persisted top-level section order. */
export const SECTION_ORDER_KEY = "ryu:sidebar-section-order";

/** One built-in section: its stable key, its label, and its glyph. */
interface BuiltinSectionSpec {
	icon: IconSvgElement;
	key: string;
	label: string;
}

/**
 * The built-in sections, **in default display order**. This array is the single
 * source of truth: {@link BuiltinSectionKey}, {@link DEFAULT_SECTION_ORDER},
 * {@link SECTION_LABELS} and {@link SECTION_ICONS} are all derived from it.
 *
 * All workspace projects/folders live nested under the single `projects` section.
 */
export const BUILTIN_SECTIONS = [
	{ key: "tabs", label: "Tabs", icon: GridIcon },
	{ key: "agents", label: "Agents", icon: Target01Icon },
	{ key: "teams", label: "Teams", icon: UserGroupIcon },
	{ key: "projects", label: "Projects", icon: FolderOpenIcon },
	{ key: "pinned", label: "Pinned", icon: PinIcon },
	{ key: "chats", label: "Chats", icon: BookOpen01Icon },
	{ key: "spaces", label: "Spaces", icon: DeliverySecure01Icon },
	{ key: "channels", label: "Channels", icon: BubbleChatIcon },
	{ key: "integrations", label: "Integrations", icon: ConnectIcon },
	{ key: "plugins", label: "Plugins", icon: PuzzleIcon },
	{ key: "companions", label: "Apps", icon: GridIcon },
	{ key: "identities", label: "Identities", icon: Key01Icon },
	{ key: "workflows", label: "Workflows", icon: WorkflowCircle06Icon },
	{ key: "skills", label: "Skills", icon: Mortarboard01Icon },
	{ key: "mcp", label: "MCP", icon: ServerStack01Icon },
	{ key: "tools", label: "Tools", icon: Wrench01Icon },
	{ key: "engines", label: "Engines", icon: CpuIcon },
	{ key: "archived", label: "Archived", icon: Archive01Icon },
] as const satisfies readonly BuiltinSectionSpec[];

/** The fixed, built-in sidebar sections (always present). */
export type BuiltinSectionKey = (typeof BUILTIN_SECTIONS)[number]["key"];

/** A dynamic, app-registered section key: `plugin:<pluginId>:<sectionId>`, minted
 *  from a `sidebar_sections` contribution. Namespaced so it never collides with a
 *  built-in key and is recognisable by prefix in the order/persistence machinery. */
export type DynamicSectionKey = `plugin:${string}`;

/** The reorderable top-level sidebar sections — the fixed built-ins plus any
 *  app-registered dynamic sections from the contributions feed. */
export type SectionKey = BuiltinSectionKey | DynamicSectionKey;

/** Default top-level order, derived from {@link BUILTIN_SECTIONS}. */
export const DEFAULT_SECTION_ORDER: BuiltinSectionKey[] = BUILTIN_SECTIONS.map(
	(section) => section.key
);

/**
 * The order shipped BEFORE `pinned` was promoted above `chats`. Deliberately a
 * frozen literal rather than something derived: it is a historical snapshot that
 * {@link reconcileSectionOrder} compares a stored order against to detect "this
 * user never customised anything, they just have the old default persisted" and
 * migrate them onto the current default. Deriving it would make it track the
 * present and silently stop migrating anyone. Never edit it — add a new snapshot
 * if the default changes again.
 */
const LEGACY_DEFAULT_SECTION_ORDER: BuiltinSectionKey[] = [
	"tabs",
	"agents",
	"teams",
	"projects",
	"chats",
	"spaces",
	"channels",
	"integrations",
	"plugins",
	"identities",
	"workflows",
	"skills",
	"mcp",
	"tools",
	"engines",
	"pinned",
	"archived",
];

/** Human labels for the built-in sections, shared by the customize dialog. */
export const SECTION_LABELS = Object.fromEntries(
	BUILTIN_SECTIONS.map((section) => [section.key, section.label])
) as Record<BuiltinSectionKey, string>;

/** Glyphs for the tabbed-mode button bar (one per built-in section). */
export const SECTION_ICONS = Object.fromEntries(
	BUILTIN_SECTIONS.map((section) => [section.key, section.icon])
) as Record<BuiltinSectionKey, IconSvgElement>;

/** A dynamic app-registered section key (`plugin:<pluginId>:<sectionId>`). */
export function isDynamicSectionKey(value: string): value is DynamicSectionKey {
	return value.startsWith("plugin:");
}

export function isSectionKey(value: string): value is SectionKey {
	// Accept dynamic `plugin:` keys too, so a persisted order keeps an app's section
	// in place across reloads (it renders nothing when that app is disabled/absent).
	return (
		isDynamicSectionKey(value) ||
		(DEFAULT_SECTION_ORDER as string[]).includes(value)
	);
}

/**
 * Reconcile a stored order against the code. The stored order can drift from the
 * build (sections added/removed across versions, apps installed/uninstalled), so:
 * keep the stored order for known keys, drop unknown ones, and splice any section
 * the user has never seen back into its default neighbourhood (so a newly-added
 * section like Workflows lands next to Spaces rather than at the very bottom).
 *
 * Exported separately from {@link loadSectionOrder} so the reconciliation — the
 * part that must never lose a user's saved layout — is testable without a DOM.
 */
export function reconcileSectionOrder(parsed: string[]): SectionKey[] {
	const order = [...new Set(parsed.filter(isSectionKey))];
	if (
		order.length === LEGACY_DEFAULT_SECTION_ORDER.length &&
		order.every((key, index) => key === LEGACY_DEFAULT_SECTION_ORDER[index])
	) {
		return [...DEFAULT_SECTION_ORDER];
	}
	const missing = DEFAULT_SECTION_ORDER.filter((k) => !order.includes(k));
	for (const key of missing) {
		const defaultIdx = DEFAULT_SECTION_ORDER.indexOf(key);
		// Anchor to the nearest already-present predecessor in the default order;
		// insert right after it, or at the front when there is none.
		let insertAt = 0;
		for (let i = defaultIdx - 1; i >= 0; i--) {
			const idx = order.indexOf(DEFAULT_SECTION_ORDER[i]);
			if (idx !== -1) {
				insertAt = idx + 1;
				break;
			}
		}
		order.splice(insertAt, 0, key);
	}
	return order;
}

export function loadSectionOrder(): SectionKey[] {
	try {
		const stored = localStorage.getItem(SECTION_ORDER_KEY);
		if (!stored) {
			return [...DEFAULT_SECTION_ORDER];
		}
		return reconcileSectionOrder(JSON.parse(stored) as string[]);
	} catch {
		return [...DEFAULT_SECTION_ORDER];
	}
}

export function saveSectionOrder(order: SectionKey[]) {
	try {
		localStorage.setItem(SECTION_ORDER_KEY, JSON.stringify(order));
	} catch {
		// best-effort
	}
}
