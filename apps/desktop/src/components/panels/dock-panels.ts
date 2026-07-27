// The data-driven half of the workspace docks: turning an enabled app's
// `contributes.dock_panels[]` entries into dock tabs.
//
// Historically the two docks welded every openable panel into a closed `TabKind`
// union (`"browser" | "simulator" | …`), so shipping an app meant editing the
// shell. `dock_panels` inverts that: an app DECLARES its tab (title, icon,
// placement, order) and the shell renders it, which also means disabling the app
// removes the tab with no shell change. The shell keeps owning the panels that
// are genuinely shell infrastructure (terminal, code review, files, cowork,
// subagent, artifact, inspector) — those are not apps and have nothing to
// contribute from.
//
// Everything here is PURE (no React, no fetch) so the ordering/placement/
// resolution rules are unit-testable; the rendering half lives in
// `WorkspacePanels.tsx`, which owns the native component registry.

import { DOCK_PANEL_KINDS, type DockPanelKind } from "@ryu/app-host/views";
import type { PluginDockPanel } from "@/src/lib/api/plugins.ts";

/** One of the two workspace docks a panel can be offered in. `"both"` is a
 *  PLACEMENT, never a dock — it fans out into these two. */
export type DockSide = "bottom" | "right";

/** Panels the SHELL owns. Not apps: they render shell infrastructure (a terminal,
 *  the diff of the open folder, the current run's cowork context …) and are
 *  always offered, contributions or not. */
export type BuiltinTabKind =
	| "terminal"
	| "codereview"
	| "files"
	| "cowork"
	| "subagent"
	| "artifact"
	| "inspector";

/** A contributed panel's tab kind: the `plugin:<pluginId>:<panelId>` key minted
 *  by {@link pluginDockPanelKey}. Kept as a template-literal type so a tab kind
 *  stays a closed shape (built-in member OR namespaced plugin key) rather than
 *  collapsing to bare `string`. */
export type PluginTabKind = `plugin:${string}`;

/** What a dock tab is: a shell-owned panel or an app-contributed one. */
export type DockTabKind = BuiltinTabKind | PluginTabKind;

/** True when the tab is an app-contributed panel rather than a built-in. */
export function isPluginTabKind(kind: DockTabKind): kind is PluginTabKind {
	return kind.startsWith("plugin:");
}

/**
 * Kinds that can be pinned and shared across chats in the same project folder.
 *
 * Workspace infrastructure (terminal, files, changes, app panels) belongs to the
 * project, not a single chat — pinning opts them into that shared strip. Chat-run
 * panels (cowork / subagent / artifact / inspector) stay conversation-local and
 * are never pinnable.
 */
export function isPinnableDockTabKind(kind: DockTabKind): boolean {
	if (isPluginTabKind(kind)) {
		return true;
	}
	return kind === "terminal" || kind === "files" || kind === "codereview";
}

/**
 * The tab kind identifying a contributed panel: `plugin:<pluginId>:<panelId>`.
 *
 * This is the same key `pluginDockPanelKey` in `hooks/usePluginContributions.ts`
 * mints, spelled out here rather than imported so this module stays free of the
 * React/query graph — it is the pure, unit-tested half of the dock, and pulling a
 * hooks module (and the pages it registers routes for) in behind it would make
 * every test load the app. The format is asserted in `dock-panels.test.ts`; if it
 * ever changes, both definitions move together.
 */
export function dockTabKind(panel: {
	id: string;
	plugin: string;
}): PluginTabKind {
	return `plugin:${panel.plugin}:${panel.id}`;
}

/** The registry key a `panel: "native"` entry resolves its shell component by —
 *  `<plugin>/<id>`, as documented on the Rust `DockPanelContribution`. */
export function nativeDockPanelKey(panel: {
	id: string;
	plugin: string;
}): string {
	return `${panel.plugin}/${panel.id}`;
}

/** Whether `panel` names a render mode this build knows how to draw. An unknown
 *  member (a newer Core, a hand-written manifest) must degrade to a placeholder,
 *  never crash the dock — the same forward-compatibility rule the contract states. */
export function isKnownDockPanelKind(panel: string): panel is DockPanelKind {
	return (DOCK_PANEL_KINDS as readonly string[]).includes(panel);
}

/** Whether a contributed panel is offered in `side`. Mirrors the Rust
 *  `DockPanelPlacement::docks()` fan-out, and is LENIENT for the same reason its
 *  deserializer is: a placement this build has never heard of falls back to the
 *  bottom dock rather than making the panel unreachable. */
export function panelDocksIn(panel: PluginDockPanel, side: DockSide): boolean {
	const placement: string = panel.placement;
	if (placement === "both") {
		return true;
	}
	if (placement === "right") {
		return side === "right";
	}
	// "bottom" and anything unknown.
	return side === "bottom";
}

/** Panels carrying no explicit `order` sort after the ordered ones, then
 *  alphabetically — a stable, declaration-order-independent result (Core
 *  concatenates contributions in manifest-load order, which is not meaningful). */
const UNORDERED = Number.MAX_SAFE_INTEGER;

function compareContributions(
	a: { id: string; order?: number; plugin: string; title: string },
	b: { id: string; order?: number; plugin: string; title: string }
): number {
	const byOrder = (a.order ?? UNORDERED) - (b.order ?? UNORDERED);
	if (byOrder !== 0) {
		return byOrder;
	}
	const byTitle = a.title.localeCompare(b.title);
	if (byTitle !== 0) {
		return byTitle;
	}
	return dockTabKind(a).localeCompare(dockTabKind(b));
}

/** The contributed panels offered in one dock, honouring `placement` (with
 *  `"both"` fanned out) and `order`. Entries missing the identity fields Core is
 *  supposed to tag (`plugin`) are dropped: without an owner there is no tab key,
 *  no native registry lookup and no capability owner. */
export function dockPanelsFor(
	panels: PluginDockPanel[],
	side: DockSide
): PluginDockPanel[] {
	return panels
		.filter(
			(p) =>
				typeof p.plugin === "string" &&
				p.plugin.length > 0 &&
				typeof p.id === "string" &&
				p.id.length > 0 &&
				panelDocksIn(p, side)
		)
		.sort(compareContributions);
}

/** The contributed panel a plugin tab kind refers to, or undefined once the
 *  owning app is disabled/uninstalled (Core only serves ENABLED plugins'
 *  contributions, so the feed IS the enabled set). Callers render a placeholder
 *  in that case rather than closing the tab: the contributions query is a
 *  best-effort read (`retry: false`), so an empty feed can also mean "the node is
 *  briefly unreachable", and a blip must not destroy the user's open tabs. */
export function findDockPanel(
	panels: PluginDockPanel[],
	kind: DockTabKind
): PluginDockPanel | undefined {
	if (!isPluginTabKind(kind)) {
		return;
	}
	return panels.find((p) => p.plugin && p.id && dockTabKind(p) === kind);
}
