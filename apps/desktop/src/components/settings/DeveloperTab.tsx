// apps/desktop/src/components/settings/DeveloperTab.tsx
//
// The App Settings "Developer" section. A single master toggle enables
// Developer Mode, which unlocks debug-in-prod tools: the Agentation visual
// annotation toolbar, a console-output ring buffer on the crash screen, one-click
// diagnostics export, and a live view of the captured console. All toggles and
// actions are gated behind the master switch — flipping it off hides everything
// immediately.

import { Button } from "@ryu/ui/components/button";
import { toast } from "@ryu/ui/components/sileo.tsx";
import { Switch } from "@ryu/ui/components/switch";
import { useCallback, useEffect, useState } from "react";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { useDeveloperMode } from "@/src/hooks/useDeveloperMode.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	getConsoleBufferText,
	installConsoleCapture,
	isConsoleCaptureActive,
} from "@/src/lib/console-buffer.ts";
import {
	getMcpBridgeStatus,
	type McpBridgeStatus,
	mcpBridgeConfigSnippet,
} from "@/src/lib/mcp-bridge.ts";
import { copyDiagnostics } from "@/src/lib/preflight.ts";
import {
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

export function DeveloperTab() {
	const [devMode, setDevMode] = useDeveloperMode();
	const [consoleActive, setConsoleActive] = useState(isConsoleCaptureActive);
	const [bridge, setBridge] = useState<McpBridgeStatus | null>(null);
	const activeNode = useActiveNode();

	const target: ApiTarget = {
		url: activeNode.url,
		token: activeNode.token ?? null,
	};

	// When the user enables developer mode, activate console capture immediately
	// so the buffer starts filling without a reload.
	const handleToggleDevMode = useCallback(
		(next: boolean) => {
			setDevMode(next);
			if (next && !isConsoleCaptureActive()) {
				installConsoleCapture(true);
				setConsoleActive(true);
			}
		},
		[setDevMode]
	);

	// Keep the console-active status in sync (e.g. after a hot reload).
	useEffect(() => {
		setConsoleActive(isConsoleCaptureActive());
	}, [devMode]);

	// READ-ONLY. Arming the bridge is not this tab's job: startup CONSUMES the
	// on-disk flag (`take_enabled` in src-tauri/src/mcp_bridge.rs), so it must be
	// re-written once per launch by something that always runs — `useMcpBridgeArming`,
	// mounted app-wide. Reconciling from a settings tab instead was the hole: a
	// user who turned Developer Mode off anywhere else, or never reopened this
	// tab, would never disarm a bridge that something else had armed.
	useEffect(() => {
		getMcpBridgeStatus().then(setBridge);
	}, [devMode]);

	const handleCopyMcpConfig = useCallback(async () => {
		if (!bridge) {
			return;
		}
		try {
			await navigator.clipboard.writeText(mcpBridgeConfigSnippet(bridge));
			toast.success("MCP config copied to clipboard");
		} catch {
			toast.error("Couldn't copy to clipboard");
		}
	}, [bridge]);

	const handleCopyDiagnostics = useCallback(async () => {
		try {
			await copyDiagnostics(target);
			toast.success("Diagnostics copied to clipboard");
		} catch {
			toast.error("Couldn't copy diagnostics");
		}
	}, [target]);

	const handleCopyConsole = useCallback(async () => {
		const text = getConsoleBufferText();
		if (!text) {
			toast.error("Console buffer is empty");
			return;
		}
		try {
			await navigator.clipboard.writeText(text);
			toast.success("Console output copied to clipboard");
		} catch {
			toast.error("Couldn't copy to clipboard");
		}
	}, []);

	return (
		<div className="space-y-6">
			<SettingsSection
				caption="Enables debug tools for troubleshooting in production builds: visual annotation toolbar, console capture on crash, one-click diagnostics, and more. Your choice is remembered on this device."
				title="Developer Mode"
			>
				<SettingsGroup>
					<SettingsItem
						actions={
							<Switch
								checked={devMode}
								id="developer-mode"
								onCheckedChange={handleToggleDevMode}
							/>
						}
						description="Show the Agentation annotation toolbar, capture console output for crash reports, and enable debug utilities below."
						title="Enable developer mode"
					/>
				</SettingsGroup>
			</SettingsSection>

			{devMode ? (
				<>
					<SettingsSection
						caption="Click any UI element to annotate it with a note. Notes sync to the local Agentation MCP server (port 4747) so a coding agent can read and act on them."
						title="Agentation toolbar"
					>
						<SettingsGroup>
							<SettingsItem
								actions={<Switch checked disabled id="agentation-toolbar" />}
								description="The floating toolbar is always visible while Developer Mode is on. It connects to a local Agentation MCP server."
								title="Toolbar active"
							/>
						</SettingsGroup>
					</SettingsSection>

					<SettingsSection
						caption="A ring buffer captures recent console output so the crash screen offers a one-click 'Copy console' button. Also included in diagnostics exports."
						title="Console capture"
					>
						<SettingsGroup>
							<SettingsItem
								actions={
									<Switch
										checked={consoleActive}
										disabled
										id="console-capture"
									/>
								}
								description={
									consoleActive
										? "Capturing — up to 500 entries are kept in memory."
										: "Not yet active. It activates on next reload or when you toggle Developer Mode on."
								}
								title="Console buffer status"
							/>
						</SettingsGroup>
					</SettingsSection>

					<SettingsSection
						caption="One-click actions for collecting debug information."
						title="Diagnostics"
					>
						<SettingsGroup>
							<SettingsItem
								actions={
									<Button
										onClick={handleCopyDiagnostics}
										size="sm"
										variant="outline"
									>
										Copy diagnostics
									</Button>
								}
								description="Collects health, versions, sidecar status, and recent console output into one clipboard-ready bundle."
								title="Collect & copy diagnostics"
							/>
							<SettingsItem
								actions={
									<Button
										onClick={handleCopyConsole}
										size="sm"
										variant="outline"
									>
										Copy console
									</Button>
								}
								description="Copies the recent console output ring buffer (up to 500 entries) to your clipboard."
								title="Copy console output"
							/>
						</SettingsGroup>
					</SettingsSection>
				</>
			) : null}

			{/* OUTSIDE the Developer Mode gate on purpose, and keyed on `live` too.
			    The bridge is registered at startup and keeps listening until the
			    process exits, so switching Developer Mode off does NOT close the
			    socket — it only stops it coming back next launch. Hiding this
			    section at that moment would remove the only place that says a
			    socket is still open, along with the restart that actually closes
			    it. */}
			{bridge && (devMode || bridge.live) ? (
				<SettingsSection
					caption={`An MCP server on this machine can attach to Ryu: screenshot it, read its DOM, run JS, invoke Tauri commands. That works against a stable release build, not just a dev build. It binds ${bridge.host} only, and stays up until Ryu exits.`}
					title="Tauri MCP bridge"
				>
					<SettingsGroup>
						<SettingsItem
							actions={<Switch checked={bridge.live} disabled />}
							description={
								bridge.live
									? `Listening on ${bridge.host}:${bridge.port}. This socket accepts any local connection without a credential — and a page open in your browser counts as local — so restart Ryu to close it when you are done.`
									: "Not listening. The bridge is registered while Ryu starts, so it attaches on the next restart with Developer Mode on."
							}
							title="Bridge status"
						/>
						{bridge.live ? (
							<SettingsItem
								actions={
									<Button
										onClick={handleCopyMcpConfig}
										size="sm"
										variant="outline"
									>
										Copy MCP config
									</Button>
								}
								description={`Paste this into your agent's MCP config and attach on port ${bridge.port}. The protocol carries no bearer token, so the port is the whole connection detail — treat it as a credential and keep it off shared machines.`}
								title="Agent connection"
							>
								<pre className="overflow-x-auto rounded-md bg-background/60 p-2.5 font-mono text-[11px] text-muted-foreground leading-relaxed">
									{mcpBridgeConfigSnippet(bridge)}
								</pre>
							</SettingsItem>
						) : null}
					</SettingsGroup>
				</SettingsSection>
			) : null}
		</div>
	);
}
