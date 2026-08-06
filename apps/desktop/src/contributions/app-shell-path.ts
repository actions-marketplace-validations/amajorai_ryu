// "Where does this app want its shell page?" — the pure lookup behind
// `app-shell-routes.ts`.
//
// Kept in its own React-free module for the same reason as `companion-alias.ts`: so
// `app-shell-path.test.ts` can assert it against a literal feed without dragging the
// desktop page graph (HomePage and everything it imports) into the test runner.

import type { PluginSidebarButton } from "@/src/lib/api/plugins.ts";
import { parseContributedTarget } from "./contributed-target.ts";

/**
 * The path an app currently declares for one of its shell pages, or `null` when no
 * enabled app claims it (the app is disabled, not installed, or dropped the button).
 *
 * `null` is the actionable answer everywhere: no route, and no affordance either —
 * the same contract `resolveCompanionAlias` gives companion-backed paths.
 *
 * The button is matched on `(plugin, id)`, never on its title: a route that dies when
 * someone retitles a button is worse than a hardcoded one (see `companion-alias.ts`).
 * Any query string on the target is stripped, since `openTab` keys tabs on the bare
 * path — matching how the sidebar button itself navigates.
 */
export function resolveAppShellPath(
	buttons: readonly PluginSidebarButton[],
	plugin: string,
	button: string
): string | null {
	const declared = buttons.find((b) => b.plugin === plugin && b.id === button);
	if (!declared?.target?.startsWith("/")) {
		return null;
	}
	const { path } = parseContributedTarget(declared.target);
	// A bare "/" would register a catch-all route for the whole shell; refuse it, the
	// same way the tab-icon registry refuses a bare-"/" prefix.
	return path.length > 1 ? path : null;
}
