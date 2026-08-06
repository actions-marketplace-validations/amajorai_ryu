import { useCallback, useEffect, useId, useRef } from "react";
import { useIsActiveTab } from "@/src/contexts/TabsContext.tsx";
import {
	PAGE_CONTEXT_OWNER,
	type PageContextItem,
	useAssistantStore,
} from "@/src/store/useAssistantStore.ts";

/**
 * Publish the current page's content to the global "Ask Ryu" assistant so it
 * can answer with that context (Notion-AI style). A page calls this with a
 * snapshot of what the user is looking at; the assistant panel shows it as a
 * removable chip and embeds it into the message sent to the agent.
 *
 * Only the ACTIVE tab publishes — every chat/editor tab stays mounted at once
 * (see Layout), so gating on `useIsActiveTab` keeps a background tab from
 * stealing the context slot. The context is cleared when the page unmounts or
 * stops being the focused tab, so the assistant falls back to the generic
 * "current page" context the panel derives on its own.
 *
 * Pass `null` to publish nothing (e.g. while the page is still loading).
 *
 * # Static vs live
 *
 * `text` is a snapshot taken when the effect runs — right for a document, wrong
 * for anything that refreshes itself. A live surface passes `getText` instead
 * and the panel calls it at SEND time. `getText`'s identity is read through a
 * ref, so a page may pass an inline closure without re-publishing every render.
 */
export function useAssistantPageContext(item: PageContextItem | null): void {
	const isActive = useIsActiveTab();
	const publishContext = useAssistantStore((s) => s.publishContext);
	const clearContextOwner = useAssistantStore((s) => s.clearContextOwner);
	// One owner key per hook INSTANCE. Every mounted tab keeps its hooks alive, and
	// React does not order a blurring page's cleanup against the newly-focused
	// page's publish — sharing one `page` key means the loser's cleanup wipes the
	// winner's context on a tab switch. The `page:` prefix keeps the namespace
	// legible next to the bridge's `plugin:<id>`.
	const instanceId = useId();
	const owner = `${PAGE_CONTEXT_OWNER}:${instanceId}`;

	const id = item?.id;
	const title = item?.title;
	const text = item?.text;

	// The resolver changes identity every render; keep the published closure
	// stable so a live page doesn't thrash the store (same indirection
	// `useAssistantBuilder` uses for its resolve/refresh callbacks).
	const getTextRef = useRef(item?.getText);
	getTextRef.current = item?.getText;
	const hasGetText = Boolean(item?.getText);
	const stableGetText = useCallback(() => getTextRef.current?.() ?? "", []);

	useEffect(() => {
		if (!(isActive && id && title)) {
			return;
		}
		publishContext(owner, [
			{
				id,
				title,
				text: text ?? "",
				getText: hasGetText ? stableGetText : undefined,
			},
		]);
		return () => clearContextOwner(owner);
	}, [
		isActive,
		id,
		title,
		text,
		hasGetText,
		stableGetText,
		owner,
		publishContext,
		clearContextOwner,
	]);
}
