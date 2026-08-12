// apps/desktop/src/hooks/useComposerDraftAutosave.ts
//
// Keep composer text that was never sent.
//
// The composer's text lives in `AgentChat`'s own state, so closing the tab (or the
// app) destroys it. That is fine for a stray keystroke and infuriating for a
// paragraph you spent five minutes on. This hook mirrors the text into the
// `@ryu/drafts` outbox, keyed on the conversation, so it comes back in the sidebar
// instead of disappearing.
//
// Three properties this has to get right, all of them about NOT being annoying:
//
//  1. One draft per conversation, not one per typing pause. The draft id is derived
//     from the conversation, so every save edits the same row.
//  2. Clearing the composer deletes the draft. The sidecar treats a blank upsert as
//     a delete, so sending a message (which clears the text) removes the draft
//     without a second call — and without a race where the delete lands before the
//     send.
//  3. Nothing is written until the text is worth keeping: the app must be enabled,
//     autosave must be on, and the text must clear `autosave_min_chars`.

import { useCallback, useEffect, useRef } from "react";
import { useAppShellPath } from "@/src/contributions/app-shell-routes.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	DRAFTS_BUTTON_ID,
	DRAFTS_PLUGIN_ID,
	getDraftsSettings,
	saveDraft,
} from "@/src/lib/api/drafts.ts";
import { useActiveNode } from "./useActiveNode.ts";

/** How long the composer must be idle before the text is written. Long enough that
 *  ordinary typing produces one write per thought rather than one per word. */
const DEBOUNCE_MS = 1500;

/** Settings are re-read at most this often. They change when a user toggles a
 *  switch on the Drafts page, which is rare; re-reading per keystroke would be a
 *  request storm for a value that is almost always the same. */
const SETTINGS_TTL_MS = 60_000;

/**
 * The draft id for one conversation's composer.
 *
 * One stable id per conversation, so every save EDITS that row rather than leaving a
 * trail of one draft per typing pause. Characters outside `[a-zA-Z0-9_-]` are
 * stripped because the sidecar refuses ids with separators — they are primary keys
 * and path segments.
 *
 * Exported because the auto-queue path in `ChatPage` arms the SAME row: a queued
 * send and the autosave of the text it came from are one draft, not two.
 */
export function draftIdFor(conversationId?: string): string {
	const key = (conversationId ?? "launchpad").replace(/[^a-zA-Z0-9_-]/g, "");
	return `composer_${key}`.slice(0, 64);
}

export interface ComposerDraftContext {
	agentId?: string;
	/** The conversation being typed into. A tab with no conversation yet still
	 *  autosaves — under its provisional id — because the launchpad is exactly
	 *  where a long unsent prompt gets abandoned. */
	conversationId?: string;
	folderPath?: string;
	model?: string;
}

/**
 * Returns the `onDraftChange` handler to hand to `AgentChat`.
 *
 * A no-op that still returns a stable callback when the app is disabled, so the
 * consumer never has to branch.
 */
export function useComposerDraftAutosave(
	context: ComposerDraftContext
): (draft: string) => void {
	const node = useActiveNode();
	const enabled = useAppShellPath(DRAFTS_PLUGIN_ID, DRAFTS_BUTTON_ID) !== null;
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const settings = useRef<{ at: number; enabled: boolean; min: number } | null>(
		null
	);
	// The context in a ref so a changing folder/agent does not re-create the
	// callback and reset the debounce mid-sentence.
	const ctx = useRef(context);
	ctx.current = context;

	useEffect(
		() => () => {
			if (timer.current) {
				clearTimeout(timer.current);
			}
		},
		[]
	);

	return useCallback(
		(draft: string) => {
			if (!enabled) {
				return;
			}
			if (timer.current) {
				clearTimeout(timer.current);
			}
			// Snapshot the id NOW, from the context the text was typed under — never
			// at flush time. Sending from the launchpad creates the conversation, so
			// `ctx.current.conversationId` moves between the keystroke and the flush
			// 1.5s later. Reading it late made the clearing flush blank-upsert
			// `composer_<newConvId>` (a row that never existed) while
			// `composer_launchpad` survived holding the text that had just been sent —
			// a permanent draft of an already-sent message after every new chat.
			const id = draftIdFor(ctx.current.conversationId);
			const context = ctx.current;
			timer.current = setTimeout(async () => {
				const target = toTarget(node);
				try {
					const now = Date.now();
					if (
						!settings.current ||
						now - settings.current.at > SETTINGS_TTL_MS
					) {
						const fetched = await getDraftsSettings(target);
						settings.current = {
							at: now,
							enabled: fetched.autosave_enabled,
							min: fetched.autosave_min_chars,
						};
					}
					if (!settings.current.enabled) {
						return;
					}
					const text = draft.trim();
					// A blank composer is a DELETE, and it must not be gated on the
					// minimum-length check — otherwise clearing a long draft down to two
					// characters and then to nothing would leave the old text behind.
					if (text.length > 0 && text.length < settings.current.min) {
						return;
					}
					await saveDraft(target, {
						id,
						text: draft,
						conversation_id: context.conversationId,
						agent_id: context.agentId,
						model: context.model,
						folder_path: context.folderPath,
						source: "composer-autosave",
					});
				} catch {
					// Autosave is a courtesy, not a promise the user is waiting on. A
					// disabled app, a down node or a 404 route all mean "no draft kept",
					// and surfacing that as an error while someone is typing would be
					// worse than the thing it reports.
				}
			}, DEBOUNCE_MS);
		},
		[enabled, node]
	);
}
