// apps/desktop/src/lib/mcp-bridge.ts
//
// Thin client for the Developer-Mode Tauri MCP bridge (`src-tauri/src/mcp_bridge.rs`).
//
// The bridge is a WebSocket that lets an external MCP server drive this app, so
// it is registered at launch only when the user has opted in. That means the
// opt-in has to live on disk, not just in the `ryu_developer_mode` localStorage
// key, and the settings tab mirrors the master toggle here.
//
// The generated snippet targets `@hypothesi/tauri-mcp-server` (the `tauri` entry
// in the repo's own `.mcp.json`) because that is the client this plugin's wire
// protocol is written for. It carries no credential: the server dials a bare
// `ws://host:port` and reads only MCP_BRIDGE_HOST/MCP_BRIDGE_PORT, so the port
// is the whole of the connection detail and the gate is that the socket exists
// only while Developer Mode is on.

import { invokeWhenReady } from "./tauri-ready.ts";
import { useEffect } from "react";

/** Mirrors `BridgeStatus` in `src-tauri/src/mcp_bridge.rs`. */
export interface McpBridgeStatus {
	/** The persisted opt-in: what the next launch will do. */
	enabled: boolean;
	host: string;
	/** Whether the bridge is listening in the running process. */
	live: boolean;
	/** The opt-in changed since launch, so it needs a relaunch to take effect. */
	needs_relaunch: boolean;
	port: number;
}

/** Current bridge state, or `null` outside Tauri (storyboard, vite preview). */
export async function getMcpBridgeStatus(): Promise<McpBridgeStatus | null> {
	try {
		return await invokeWhenReady<McpBridgeStatus>("mcp_bridge_status");
	} catch {
		return null;
	}
}

/**
 * Push the Developer Mode master toggle into the on-disk opt-in. Idempotent, so
 * it doubles as the reconcile call on mount: a cleared localStorage would
 * otherwise leave the bridge armed for the next launch with the UI showing
 * Developer Mode off.
 */
export async function setMcpBridgeEnabled(
	enabled: boolean
): Promise<McpBridgeStatus | null> {
	try {
		return await invokeWhenReady<McpBridgeStatus>("set_mcp_bridge_enabled", { enabled });
	} catch {
		return null;
	}
}

/**
 * The MCP server entry to paste into an agent's config. Windows gets the
 * `cmd /c` wrapper the repo's own `.mcp.json` uses, since `npx` there is a shim
 * the raw spawn cannot resolve.
 */
export function mcpBridgeConfigSnippet(status: McpBridgeStatus): string {
	const onWindows = navigator.userAgent.includes("Windows");
	return JSON.stringify(
		{
			mcpServers: {
				"ryu-desktop": {
					command: onWindows ? "cmd" : "npx",
					args: onWindows
						? ["/c", "npx", "-y", "@hypothesi/tauri-mcp-server"]
						: ["-y", "@hypothesi/tauri-mcp-server"],
					env: {
						MCP_BRIDGE_HOST: status.host,
						MCP_BRIDGE_PORT: String(status.port),
					},
				},
			},
		},
		null,
		2
	);
}

/**
 * Mirror Developer Mode into the on-disk arming flag once per app launch.
 *
 * This MUST run app-wide at boot, not on the Developer settings tab's mount.
 * Startup consumes the flag (`take_enabled` in `mcp_bridge.rs`), so the flag is
 * re-written on every launch by whoever is authoritative about Developer Mode —
 * and the only honest authority is the master toggle, read here, on every start.
 *
 * Doing it on the settings tab instead left two holes: a user who turned
 * Developer Mode off somewhere else, or simply never reopened that tab, would
 * never reconcile, so a flag armed by anything else stayed armed. Since the live
 * bridge exposes `invoke_tauri` to any web page that connects (see the module
 * docs in `mcp_bridge.rs`), "armed by anything else" is a reachable state, not a
 * hypothetical.
 */
export function useMcpBridgeArming(devMode: boolean): void {
	useEffect(() => {
		// Off is written too, and that write is the point: it is what guarantees a
		// bridge armed by any other means does not survive the next launch.
		void setMcpBridgeEnabled(devMode);
	}, [devMode]);
}
