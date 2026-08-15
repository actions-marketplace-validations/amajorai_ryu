// DesktopStreamPanel — the "Virtual Desktop" workspace panel.
//
// Live, INTERACTIVE stream of the active node's virtual desktop. The `@ryu/desktop`
// sidecar brings up a headless Xvfb + window-manager + VNC desktop on the node, and
// this panel connects an RFB client (noVNC) to `wss://<node>/api/ext/ws/@ryu/desktop/ws`
// — Core's generic WebSocket ext-proxy authenticates the node token and bridges to the
// sidecar's websockify route. Pixels come down the socket, mouse/keyboard go back up:
// the same desktop Ghost drives, so you watch the agent work and can take over.
//
// Works for EVERY node type (managed cloud, self-hosted, local) because the stream
// rides Core's existing port — no new firewall rule, and no sidecar port is ever
// exposed. When the app is disabled or the sidecar reports no display, the panel
// degrades to a clear prompt instead of a dead canvas.

import RFB from "@novnc/novnc";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { useApps } from "@/src/hooks/useApps.ts";

const DESKTOP_PLUGIN_ID = "@ryu/desktop";

/** Build the noVNC WebSocket URL for the active node, mirroring `voiceWsUrl`. */
export function desktopWsUrl(
	url: string,
	token: string | null
): string {
	const wsUrl = new URL("/api/ext/ws/@ryu/desktop/ws", url);
	wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
	if (token) {
		wsUrl.searchParams.set("token", token);
	}
	return wsUrl.toString();
}

export function DesktopStreamPanel() {
	const { apps } = useApps();
	const node = useActiveNode();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rfbRef = useRef<RFB | null>(null);
	const [connected, setConnected] = useState(false);
	const [status, setStatus] = useState<string>("idle");
	const [error, setError] = useState<string | null>(null);

	const enabled = apps.some(
		(a) => a.id === DESKTOP_PLUGIN_ID && a.enabled
	);

	const connect = useCallback(() => {
		if (!canvasRef.current || rfbRef.current) {
			return;
		}
		setError(null);
		setStatus("connecting");
		try {
			const rfb = new RFB(canvasRef.current, desktopWsUrl(node.url, node.token ?? null), {
				credentials: {},
			});
			rfb.scaleViewport = true;
			rfb.resizeSession = false;
			rfbRef.current = rfb;

			rfb.addEventListener("connect", () => {
				setConnected(true);
				setStatus("connected");
			});
			rfb.addEventListener(
				"disconnect",
				(e: CustomEvent<{ clean?: boolean; message?: string }>) => {
					setConnected(false);
					setStatus("disconnected");
					setError(
						e.detail?.message ?? "Disconnected from the virtual desktop."
					);
					rfbRef.current = null;
				}
			);
			rfb.addEventListener("credentialsrequired", () => {
				setStatus("no credentials");
				setError("The virtual desktop requested credentials.");
				rfb.disconnect();
			});
		} catch (e) {
			setConnected(false);
			setStatus("error");
			setError(
				e instanceof Error
					? e.message
					: "Couldn't connect to the virtual desktop."
			);
		}
	}, [node.url, node.token]);

	useEffect(() => {
		if (enabled && !connected && !rfbRef.current) {
			connect();
		}
		// Reconnect when the active node changes.
		return () => {
			rfbRef.current?.disconnect();
			rfbRef.current = null;
			setConnected(false);
			setStatus("idle");
		};
	}, [enabled, node.url, node.token, connect, connected]);

	if (!enabled) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground text-xs">
				<p className="max-w-xs">
					Enable the <span className="font-medium">Virtual Desktop</span> app
					to stream this node's desktop live. Install the virtual-desktop
					toolchain (xvfb, a window manager, tigervnc) on the node when
					prompted.
				</p>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			<div className="flex shrink-0 items-center gap-2 border-border/60 border-b bg-sidebar px-2 py-1.5">
				<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
					{node.name}
				</span>
				<span
					className={`size-1.5 shrink-0 rounded-full ${
						connected ? "bg-emerald-500" : "bg-muted-foreground/40"
					}`}
					title={status}
				/>
				<button
					className="rounded-md px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
					disabled={!enabled}
					onClick={() => {
						if (rfbRef.current) {
							rfbRef.current.disconnect();
							rfbRef.current = null;
						}
						connect();
					}}
					type="button"
				>
					{connected ? "Reconnect" : "Connect"}
				</button>
			</div>
			<div className="relative min-h-0 flex-1 bg-black">
				<canvas
					ref={canvasRef}
					className="absolute inset-0 h-full w-full"
				/>
				{error && (
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-muted-foreground">
						{error}
					</div>
				)}
			</div>
		</div>
	);
}
