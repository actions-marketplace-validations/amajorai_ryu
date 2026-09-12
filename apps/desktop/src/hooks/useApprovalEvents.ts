import { toast } from "@ryu/ui/components/sileo";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
	type ApprovalEvent,
	streamApprovalEvents,
} from "@/src/lib/api/approvals.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import { useActiveNode } from "./useActiveNode.ts";
import { useUserAvailability } from "./useUserAvailability.ts";

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
 * Subscribe to the Core approval-event SSE stream for the active node. A newly
 * created request raises an in-app toast + a native OS notification while the
 * user is Online, so Away and Do not disturb do not interrupt them. Every event
 * refreshes the approval queries. Auto-reconnects on drop and re-subscribes when
 * the active node changes. Mount once high in the tree (the app shell).
 */
export function useApprovalEvents(): void {
	const node = useActiveNode();
	const url = node.url;
	const token = node.token ?? null;
	const userJwt = node.userJwt ?? null;
	const qc = useQueryClient();
	const { status } = useUserAvailability();
	const statusRef = useRef(status);
	statusRef.current = status;

	useEffect(() => {
		const controller = new AbortController();
		const target: ApiTarget = { url, token, userJwt };

		const onEvent = (event: ApprovalEvent) => {
			if (event.type === "created" && statusRef.current === "online") {
				toast.info({
					title: "Approval needed",
					description: event.request.title,
				});
				osNotify(
					"Approval needed",
					event.request.summary,
					`approval-${event.request.id}`
				);
			}
			Promise.resolve(qc.invalidateQueries({ queryKey: ["approvals"] })).catch(
				() => undefined
			);
		};

		// `streamApprovalEvents` is backed by the shared event multiplexer, which
		// owns reconnect/backoff for every channel on this node.
		streamApprovalEvents(target, onEvent, controller.signal).catch(
			() => undefined
		);

		return () => {
			controller.abort();
		};
	}, [url, token, userJwt, qc]);
}
