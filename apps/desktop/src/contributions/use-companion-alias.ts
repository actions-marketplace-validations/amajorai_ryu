// The React seam over `resolveCompanionAlias`: "which enabled app answers to this
// short path, right now?"
//
// Three different questions reduce to that one lookup, and they must not be answered
// by three different mechanisms:
//   1. ROUTING — `builtins.ts`'s CompanionAliasRoute mounts the resolved companion.
//   2. AFFORDANCE — a shell surface deciding whether to render an entry point at all
//      (the sidebar footer's Inbox tray). This is the one that used to be missing:
//      the route already blanked out for a disabled app, but the button that led
//      there was hardcoded shell chrome, so a fresh install (most apps ship
//      not pre-installed) showed an Inbox button whose only outcome was "App not enabled".
//   3. DEEP LINK — an OS notification click choosing a target, which must do nothing
//      rather than open a dead tab.
//
// Deriving visibility from the SAME feed the route mounts from is the whole point:
// no surface bakes a `com.ryu.*` id, and "the app is gone", "the button is gone" and
// "the path resolves to nothing" are one fact rather than three that can disagree.
//
// Kept out of `companion-alias.ts` so that module stays React-free and unit-testable
// against a literal feed.

import { useMemo } from "react";
import { usePluginContributions } from "@/src/hooks/usePluginContributions.ts";
import { resolveCompanionAlias } from "./companion-alias.ts";

/**
 * The companion id an enabled app contributes for `alias`, or `null` when no enabled
 * app claims it. `null` is the actionable answer: hide the affordance.
 */
export function useCompanionAlias(alias: string): string | null {
	const { companions, sidebar_buttons: buttons } = usePluginContributions();
	return useMemo(
		() =>
			resolveCompanionAlias({ companions, sidebar_buttons: buttons }, alias),
		[companions, buttons, alias]
	);
}
