import { toast } from "@ryu/ui/components/sileo";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import { type Alert, streamMonitorAlerts } from "@/src/lib/api/monitors.ts";
import { useActiveNode } from "./useActiveNode.ts";

/** Raise a native OS notification (best-effort; requests permission once). */
function osNotify(alert: Alert): void {
	if (typeof Notification === "undefined") {
		return;
	}
	const show = () => {
		try {
			const n = new Notification(`${alert.monitor_name}: ${alert.title}`, {
				body: alert.message,
				tag: `monitor-${alert.monitor_id}`,
			});
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
 * Subscribe to the Core monitor-alert SSE stream for the active node. Each alert
 * raises an in-app toast and a native OS notification, and refreshes the alert
 * queries. Auto-reconnects on drop and re-subscribes when the active node
 * changes. Mount once high in the tree (e.g. the app shell).
 */
export function useMonitorAlertsStream(): void {
	const node = useActiveNode();
	const url = node.url;
	const token = node.token ?? null;
	const userJwt = node.userJwt ?? null;
	const qc = useQueryClient();

	useEffect(() => {
		const controller = new AbortController();
		const target: ApiTarget = { url, token, userJwt };

		const onAlert = (alert: Alert) => {
			toast.error({ title: alert.title, description: alert.message });
			osNotify(alert);
			Promise.resolve(qc.invalidateQueries({ queryKey: ["monitors"] })).catch(
				() => undefined
			);
		};

		// The shared event multiplexer owns reconnect/backoff for this channel.
		streamMonitorAlerts(target, onAlert, controller.signal).catch(
			() => undefined
		);

		return () => {
			controller.abort();
		};
	}, [url, token, userJwt, qc]);
}
