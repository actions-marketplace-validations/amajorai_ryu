import { useEffect } from "react";
import { fetchGatewayConfig } from "@/src/lib/api/gateway.ts";
import { invokeWhenReady, isTauriReady } from "@/src/lib/tauri-ready.ts";
import { isLocalNode } from "@/src/store/useNodeStore.ts";
import { useActiveNode } from "./useActiveNode.ts";

const POLL_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Keeps the OS awake only while a local ACP process is actually active. The
 * preference is stored in Gateway, while the native assertion belongs to Tauri;
 * polling the existing proxied config keeps the two sides aligned after an app
 * restart, a node switch, or an agent's idle reap.
 */
export function useAcpKeepAwake(): void {
	const { url, token, userJwt } = useActiveNode();

	useEffect(() => {
		const lifetime = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const target = { url, token: token ?? null, userJwt: userJwt ?? null };

		const sync = async () => {
			try {
				if (!isTauriReady()) {
					return;
				}
				let shouldKeepAwake = false;
				if (isLocalNode({ url })) {
					try {
						const config = await fetchGatewayConfig(
							target,
							AbortSignal.any([
								lifetime.signal,
								AbortSignal.timeout(REQUEST_TIMEOUT_MS),
							])
						);
						shouldKeepAwake =
							config.acp.keep_computer_awake &&
							(config.acp.active_agents ?? 0) > 0;
					} catch {
						// A down Core/Gateway must never leave a stale native inhibitor on.
						shouldKeepAwake = false;
					}
				}
				if (lifetime.signal.aborted) {
					return;
				}
				// Reapply unchanged state too: the native command repairs exited helpers.
				await invokeWhenReady("set_keep_awake", {
					enabled: shouldKeepAwake,
				});
			} catch {
				// Retry an unsuccessful native assertion on the next poll.
			} finally {
				if (!lifetime.signal.aborted) {
					timer = setTimeout(() => void sync(), POLL_INTERVAL_MS);
				}
			}
		};

		void sync();
		return () => {
			lifetime.abort();
			clearTimeout(timer);
		};
	}, [url, token, userJwt]);
}
