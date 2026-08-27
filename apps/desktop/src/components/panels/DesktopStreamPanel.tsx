// DesktopStreamPanel — the "Virtual Desktop" workspace panel.
//
// Live, INTERACTIVE stream of the active node's virtual desktop. The `@ryu/desktop`
// sidecar brings up headless Linux displays on the node, and this panel connects an
// RFB client (noVNC) to the authenticated Core WebSocket route for the selected Bot.
// Pixels come down the socket and mouse/keyboard go back up to the same selected
// Bot screen. The Virtual Desktop satellite owns those sessions end to end.
//
// Managed cloud nodes allocate one screen per Bot. Self-hosted and local Linux nodes
// retain the legacy single-screen lane. The stream rides Core's existing port — no
// new firewall rule, and no sidecar port is ever exposed. When the app is disabled or
// the sidecar reports no display, the panel degrades to a clear prompt instead of a
// dead canvas.

/// <reference path="../../novnc.d.ts" />

import RFB from "@novnc/novnc";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { useAgents } from "@/src/hooks/useAgents.ts";
import { useApps } from "@/src/hooks/useApps.ts";
import { clearMediaSource, publishMediaSource } from "@/src/lib/media-pip.ts";
import { getRealtimeJwt } from "@/src/lib/realtime/jwt.ts";

const DESKTOP_PLUGIN_ID = "@ryu/desktop";

/** Build the noVNC WebSocket URL for the active node, mirroring `voiceWsUrl`. */
export function desktopWsUrl(
	url: string,
	token: string | null,
	jwt: string | null = null,
	agentId = "ryu"
): string {
	const safeAgentId = agentId.trim();
	const wsUrl = new URL(
		safeAgentId
			? `/api/ext/ws/@ryu/desktop/bots/${encodeURIComponent(safeAgentId)}/ws`
			: "/api/ext/ws/@ryu/desktop/ws",
		url
	);
	wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
	if (token) {
		wsUrl.searchParams.set("token", token);
	}
	if (jwt) {
		wsUrl.searchParams.set("jwt", jwt);
	}
	return wsUrl.toString();
}

export function DesktopStreamPanel({ active = true }: { active?: boolean }) {
	const { apps } = useApps();
	const { agents } = useAgents();
	const node = useActiveNode();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rfbRef = useRef<RFB | null>(null);
	const [connected, setConnected] = useState(false);
	const [status, setStatus] = useState<string>("idle");
	const [error, setError] = useState<string | null>(null);
	const [selectedAgentId, setSelectedAgentId] = useState("ryu");
	const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
	const sourceId = `desktop:${node.url}:${selectedAgentId}`;

	useEffect(() => {
		if (agents.length === 0) {
			return;
		}
		setSelectedAgentId((current) => {
			if (agents.some((agent) => agent.id === current)) {
				return current;
			}
			return agents.find((agent) => agent.id === "ryu")?.id ?? agents[0].id;
		});
	}, [agents]);

	const enabled = apps.some((a) => a.id === DESKTOP_PLUGIN_ID && a.enabled);

	const connect = useCallback(async () => {
		if (!canvasRef.current || rfbRef.current) {
			return;
		}
		setError(null);
		setStatus("connecting");
		try {
			const jwt = await getRealtimeJwt();
			if (!canvasRef.current || rfbRef.current) {
				return;
			}
			const rfb = new RFB(
				canvasRef.current,
				desktopWsUrl(node.url, node.token ?? null, jwt, selectedAgentId),
				{
					credentials: {},
				}
			);
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
					clearMediaSource(sourceId);
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
	}, [node.token, node.url, selectedAgentId, sourceId]);

	useEffect(() => {
		if (enabled && active && !connected && !rfbRef.current) {
			connect();
		}
		// Reconnect when the active node changes.
		return () => {
			rfbRef.current?.disconnect();
			rfbRef.current = null;
			setConnected(false);
			setStatus("idle");
		};
	}, [active, enabled, node.url, node.token, connect]);

	useEffect(() => {
		if (!(active && connected)) {
			if (!active) {
				clearMediaSource(sourceId);
			}
			return;
		}
		const publishFrame = () => {
			const canvas = canvasRef.current;
			if (!(canvas && canvas.width > 0 && canvas.height > 0)) {
				return;
			}
			try {
				publishMediaSource({
					id: sourceId,
					imageUrl: canvas.toDataURL("image/jpeg", 0.76),
					kind: "desktop",
					title: `${node.name || "Remote desktop"} · ${selectedAgent?.name ?? selectedAgentId}`,
				});
			} catch {
				// A canvas can be cleared while noVNC is tearing down. The next frame
				// retries once the client paints again.
			}
		};
		publishFrame();
		const timer = window.setInterval(publishFrame, 350);
		return () => window.clearInterval(timer);
	}, [
		active,
		connected,
		node.name,
		selectedAgent?.name,
		selectedAgentId,
		sourceId,
	]);

	useEffect(() => {
		return () => clearMediaSource(sourceId);
	}, [sourceId]);

	if (!enabled) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground text-xs">
				<p className="max-w-xs">
					Enable the <span className="font-medium">Virtual Desktop</span> app to
					stream this node's desktop live. Install the virtual-desktop toolchain
					(xvfb, a window manager, tigervnc) on the node when prompted.
				</p>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col" data-live-media-source="desktop">
			<div className="flex shrink-0 items-center gap-2 border-border/60 border-b bg-sidebar px-2 py-1.5">
				<span className="min-w-0 truncate text-muted-foreground text-xs">
					{node.name}
				</span>
				<label className="sr-only" htmlFor="desktop-agent-session">
					Bot screen
				</label>
				<select
					aria-label="Bot screen"
					className="max-w-32 rounded-md border bg-background px-1.5 py-0.5 text-xs"
					id="desktop-agent-session"
					onChange={(event) => setSelectedAgentId(event.target.value)}
					value={selectedAgentId}
				>
					{agents.length === 0 ? (
						<option value="ryu">Ryu</option>
					) : (
						agents.map((agent) => (
							<option key={agent.id} value={agent.id}>
								{agent.name}
							</option>
						))
					)}
				</select>
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
				<canvas className="absolute inset-0 h-full w-full" ref={canvasRef} />
				{error && (
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-muted-foreground text-xs">
						{error}
					</div>
				)}
			</div>
		</div>
	);
}
