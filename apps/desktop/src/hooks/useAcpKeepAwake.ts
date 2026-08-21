import { useEffect, useMemo } from "react";
import { toTarget } from "@/src/lib/api/client.ts";
import { fetchGatewayConfig } from "@/src/lib/api/gateway.ts";
import { invokeWhenReady, isTauriReady } from "@/src/lib/tauri-ready.ts";
import { isLocalNode } from "@/src/store/useNodeStore.ts";
import { useActiveNode } from "./useActiveNode.ts";

const POLL_INTERVAL_MS = 10_000;

/**
 * Keeps the OS awake only while a local ACP process is actually active. The
 * preference is stored in Gateway, while the native assertion belongs to Tauri;
 * polling the existing proxied config keeps the two sides aligned after an app
 * restart, a node switch, or an agent's idle reap.
 */
export function useAcpKeepAwake(): void {
	const node = useActiveNode();
	const target = useMemo(() => toTarget(node), [node]);

	useEffect(() => {
		let cancelled = false;

		const sync = async () => {
			if (!isTauriReady()) {
				return;
			}
			let shouldKeepAwake = false;
			if (isLocalNode(node)) {
				try {
					const config = await fetchGatewayConfig(target);
					shouldKeepAwake =
						config.acp.keep_computer_awake &&
						(config.acp.active_agents ?? 0) > 0;
				} catch {
					// A down Core/Gateway must never leave a stale native inhibitor on.
					shouldKeepAwake = false;
				}
			}
			if (cancelled) {
				return;
			}
			await invokeWhenReady("set_keep_awake", {
				enabled: shouldKeepAwake,
			}).catch(() => undefined);
		};

		void sync();
		const timer = window.setInterval(() => void sync(), POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [node, target]);
}
