import { toast } from "@ryu/ui/components/sileo";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import { type QuestEvent, streamQuestEvents } from "@/src/lib/api/quests.ts";
import { useActiveNode } from "./useActiveNode.ts";

/** Raise a native OS notification (best-effort; requests permission once). */
function osNotify(title: string, body: string, tag: string): void {
	if (typeof Notification === "undefined") {
		return;
	}
	const show = () => {
		try {
			const n = new Notification(title, { body, tag });
			n.onclick = () => window.focus();
		} catch {
			// Notification construction can throw on some platforms; ignore.
		}
	};
	if (Notification.permission === "granted") {
		show();
	} else if (Notification.permission === "default") {
		Notification.requestPermission()
			.then((perm) => {
				if (perm === "granted") {
					show();
				}
			})
			.catch(() => undefined);
	}
}

/**
 * Subscribe to the Core quest-event SSE stream for the active node. A detection
 * suggestion raises an in-app toast and a native OS notification; an
 * auto-completion announces itself. Every event refreshes the quest queries.
 * Auto-reconnects on drop and re-subscribes when the active node changes. Mount
 * once high in the tree (the app shell).
 */
export function useQuestEvents(): void {
	const node = useActiveNode();
	const url = node.url;
	const token = node.token ?? null;
	const userJwt = node.userJwt ?? null;
	const qc = useQueryClient();

	useEffect(() => {
		const controller = new AbortController();
		const target: ApiTarget = { url, token, userJwt };

		const onEvent = (event: QuestEvent) => {
			if (event.type === "suggested") {
				toast.info({
					title: `Looks done: ${event.quest.title}`,
					description: event.reason,
				});
				osNotify(
					`Finished "${event.quest.title}"?`,
					event.reason,
					`quest-${event.quest.id}`
				);
			} else if (event.type === "completed" && event.auto) {
				toast.success({
					title: `Auto-completed: ${event.quest.title}`,
					description:
						event.quest.suggestion?.reason ?? "Detected from your activity.",
				});
				osNotify(
					`Done: ${event.quest.title}`,
					"Ryu detected this task as finished.",
					`quest-${event.quest.id}`
				);
			}
			Promise.resolve(qc.invalidateQueries({ queryKey: ["quests"] })).catch(
				() => undefined
			);
		};

		// The shared event multiplexer owns reconnect/backoff for this channel.
		streamQuestEvents(target, onEvent, controller.signal).catch(
			() => undefined
		);

		return () => {
			controller.abort();
		};
	}, [url, token, userJwt, qc]);
}
