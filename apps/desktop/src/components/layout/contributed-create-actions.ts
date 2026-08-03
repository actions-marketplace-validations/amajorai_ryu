// apps/desktop/src/components/layout/contributed-create-actions.ts
//
// The app half of the sidebar "+" create menu. Built-in rows (New chat, New
// agent, …) are kernel-owned and stay compiled into CreateMenu; everything else
// arrives through this seam so an app can add "New meeting" / "New space"
// without a line of shell code.
//
// The seam is `contributes.sidebar_sections[].spec.create` — the same
// declaration `DynamicSidebarSection` already renders as that section's own "+"
// button. An app that owns a sidebar section therefore gets its create row in
// the menu for free, and disabling the app removes it, because
// `usePluginContributions` only ever serves ENABLED plugins.
//
// Note what this is NOT: a general "new-item action" contribution. `spec.create`
// is section-scoped (POST, then open the created row through the section's own
// `itemTarget`), so an app that contributes no sidebar section cannot put a row
// here. Closing that gap needs a dedicated `contributes.create_actions` member
// in Core, which is a kernel change, not a client one.
//
// The runner below is deliberately a separate copy of AppSidebar's, not a shared
// helper: the section's own button re-fetches its list afterwards (it owns that
// list), whereas a menu row is fire-and-open. Folding the two together would
// mean a helper that has to ask which caller it is serving.

import {
	isCoreApiPath,
	renderActionHttp,
	renderTemplate,
} from "@ryu/app-host/views";
import { useCallback, useMemo } from "react";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { usePluginContributions } from "@/src/hooks/usePluginContributions.ts";
import { apiUrl, makeHeaders, toTarget } from "@/src/lib/api/client.ts";
import type { PluginSidebarSection } from "@/src/lib/api/plugins.ts";

/** One row of the create menu. Label only — the menu renders no icons and no
 *  descriptions, so a contribution's `create.icon` is read but never drawn. */
export interface CreateMenuAction {
	id: string;
	label: string;
	onSelect: () => void;
}

/**
 * Every enabled app's contributed "New X" action, ready to concatenate after the
 * built-ins. Ordered by the contribution's `order` hint, then by title, so the
 * menu doesn't reshuffle when Core happens to return the sections differently.
 */
export function useContributedCreateActions(): CreateMenuAction[] {
	const { sidebar_sections } = usePluginContributions();
	const node = useActiveNode();
	const { openTab } = useTabsContext();

	const run = useCallback(
		async (section: PluginSidebarSection) => {
			const create = section.spec?.create;
			// Same guard the section list applies before it fetches: a contributed
			// path that is not a Core `/api/` route never reaches the authenticated
			// node seam.
			if (!(create && isCoreApiPath(create.http.path))) {
				return;
			}
			try {
				const target = toTarget(node);
				const rendered = renderActionHttp(create.http, {});
				const resp = await fetch(apiUrl(target, rendered.path), {
					method: rendered.method,
					headers: makeHeaders(target.token),
					body:
						rendered.body === undefined
							? undefined
							: JSON.stringify(rendered.body),
				});
				if (!resp.ok) {
					return;
				}
				const created = (await resp.json()) as Record<string, unknown>;
				const itemTarget = section.spec?.itemTarget;
				// `targetFrom` names the response key holding the new row's id; without
				// it (or without an `itemTarget`) the app only wanted the row created,
				// and the owning section picks it up on its next fetch.
				if (
					itemTarget &&
					create.targetFrom &&
					created[create.targetFrom] !== undefined
				) {
					openTab(
						renderTemplate(itemTarget, { item: created }, { uriEncode: true }),
						{ title: String(created.title ?? created.name ?? "Untitled") }
					);
				}
			} catch {
				// Best-effort, exactly as the section's own create button: a failed
				// create must not take the sidebar down with it.
			}
		},
		[node, openTab]
	);

	return useMemo(() => {
		const seen = new Set<string>();
		return sidebar_sections
			.filter((section) => {
				if (!section.spec?.create) {
					return false;
				}
				// A plugin may contribute several sections; key on plugin + section id
				// so two of them can't collapse into one row (or double-add).
				const key = `${section.plugin}:${section.id}`;
				if (seen.has(key)) {
					return false;
				}
				seen.add(key);
				return true;
			})
			.sort(
				(a, b) =>
					(a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title)
			)
			.map((section) => ({
				id: `contrib:${section.plugin}:${section.id}`,
				label: section.spec?.create?.label ?? `New ${section.title}`,
				onSelect: () => {
					void run(section);
				},
			}));
	}, [sidebar_sections, run]);
}
