"use client";

// The composer's Output style section (`docs/output-styles.md` §6).
//
// A style reshapes HOW the agent answers — role, tone, default response shape — by
// editing the system prompt for the turn. Ryu resolves it at turn assembly rather
// than at session start (design §7, divergence 1), which is the entire reason the
// picker belongs in the composer: switching takes effect on the next message, with
// no reload and no `/clear`.
//
// This hook returns a plain `ComposerSettingsSection`, so it composes into
// `useComposerAgentControls` exactly like the Model / Thinking / Approval sections
// and renders through the universal picker for free — there is no bespoke output-style
// control on any surface.
//
// Unlike the ACP sections next door, the selection is NOT persisted per agent in
// localStorage: a style is a node-wide prompt preset, and the file
// `POST /api/output-styles/select` writes is the same one the injection seams read
// when assembling a turn. Keeping a second, client-side copy of "which style" would
// be a second source of truth about a value the server already owns — and a stale one
// on any other surface (the Store tab, another window) the moment it drifted.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
	ComposerSettingItem,
	ComposerSettingsSection,
} from "@/components/agent-elements/input/composer-settings-menu.tsx";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import {
	listOutputStyles,
	type OutputStyleList,
	selectOutputStyle,
} from "@/src/lib/api/output-styles.ts";

/**
 * The "None" row's id. Not a real style — Core models "no style" as a null selection,
 * but a `ComposerSettingItem` needs an id to be pickable, so the sentinel lives on the
 * client and is translated back to `null` on the way out.
 *
 * Exported rather than private because it is the wire value's client-side stand-in:
 * anything reading this section's `value` has to recognise it as "nothing selected"
 * instead of a style id. (It used to gate an output-style segment on the composer
 * trigger; the trigger no longer summarises this section at all — see
 * `useComposerAgentControls` — so that is no longer a reader.)
 */
export const NO_OUTPUT_STYLE_ID = "__no_output_style__";

/** Query-key prefix for the shared style list, so a node switch can't strand a stale
 *  entry when the mutation invalidates by prefix. */
const OUTPUT_STYLES_KEY = "output-styles";

/** Re-flag the cached rows for an optimistic selection change. */
function withSelection(
	list: OutputStyleList,
	styleId: string | null
): OutputStyleList {
	return {
		...list,
		selected: styleId,
		styles: list.styles.map((s) => ({ ...s, active: s.id === styleId })),
	};
}

/**
 * The composer's Output style picker, as a `ComposerSettingsSection`.
 *
 * Returns a section with NO items — which every consumer auto-hides — when the node
 * has no styles at all (the styles plugin disabled, or a Core too old to serve the
 * endpoint), so the composer simply shows one fewer row rather than an empty picker.
 */
export function useComposerOutputStyleSection(): ComposerSettingsSection {
	const node = useActiveNode();
	const queryClient = useQueryClient();
	const queryKey = [OUTPUT_STYLES_KEY, node.url, node.token];

	const { data } = useQuery({
		queryKey,
		queryFn: () =>
			listOutputStyles({ url: node.url, token: node.token ?? null }),
		// Best-effort surface, matching the plugin-contributions read: a stale window
		// avoids hammering Core on every composer mount, and `retry: false` means an
		// older Core without this endpoint fails once, quietly, leaving `data`
		// undefined → an empty (hidden) section.
		staleTime: 30_000,
		retry: false,
	});

	const { mutate } = useMutation({
		mutationFn: (styleId: string | null) =>
			selectOutputStyle({ url: node.url, token: node.token ?? null }, styleId),
		// Optimistic, because the whole point of a composer picker is that it repaints
		// on click. No rollback path: `onSettled` refetches unconditionally, so a
		// failed write is corrected by the truth rather than by a second guess at it.
		onMutate: (styleId) => {
			queryClient.setQueryData<OutputStyleList>(queryKey, (prev) =>
				prev ? withSelection(prev, styleId) : prev
			);
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: [OUTPUT_STYLES_KEY] });
		},
	});

	return useMemo<ComposerSettingsSection>(() => {
		const styles = data?.styles ?? [];
		const forcedId = data?.forced ?? null;
		const forced = forcedId ? styles.find((s) => s.id === forcedId) : undefined;

		// A plugin forcing a style overrides all three selection tiers while it stays
		// enabled (design §5), so offering the other rows would be offering a change
		// Core discards on the next turn. Show the one style that IS in force, say why,
		// and swallow the pick — an honest read-only row beats a control that lies.
		if (forced) {
			return {
				key: "output-style",
				label: "Output style",
				ariaLabel: "Output style (set by a plugin)",
				items: [
					{
						id: forced.id,
						name: forced.name,
						description: "Set by a plugin — disable it to choose another.",
					},
				],
				value: forced.id,
				onChange: () => {
					// Intentionally inert: see above.
				},
			};
		}

		const items: ComposerSettingItem[] =
			styles.length === 0
				? []
				: [
						{
							id: NO_OUTPUT_STYLE_ID,
							name: "None",
							description: "Answer in the agent's own voice.",
						},
						...styles.map((s) => ({
							id: s.id,
							name: s.name,
							description: s.description,
						})),
					];

		return {
			key: "output-style",
			label: "Output style",
			ariaLabel: "Select output style",
			items,
			value: data?.selected ?? NO_OUTPUT_STYLE_ID,
			onChange: (id) => {
				mutate(id === NO_OUTPUT_STYLE_ID ? null : id);
			},
			// Deliberately no `loading` flag. The section would then render a
			// "Detecting…" row on every composer mount while the (cached, 30s-stale)
			// list is in flight — noise for a picker whose empty state is already the
			// correct one: nothing to offer yet, so nothing shown.
		};
	}, [data, mutate]);
}
