// apps/desktop/src/components/settings/DeveloperTab.tsx
//
// The App Settings "Developer" section. A single master toggle enables
// Developer Mode, which unlocks debug-in-prod tools: the Agentation visual
// annotation toolbar, a console-output ring buffer on the crash screen, one-click
// diagnostics export, and a live view of the captured console. All toggles and
// actions are gated behind the master switch — flipping it off hides everything
// immediately.

import { Button } from "@ryu/ui/components/button.tsx";
import { toast } from "@ryu/ui/components/sileo.tsx";
import { Switch } from "@ryu/ui/components/switch.tsx";
import { useCallback, useEffect, useState } from "react";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { useDeveloperMode } from "@/src/hooks/useDeveloperMode.ts";
import { useMidnightWipe } from "@/src/hooks/useMidnightWipe.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import { channelLabel } from "@/src/lib/channel-brand.ts";
import {
	getConsoleBufferText,
	installConsoleCapture,
	isConsoleCaptureActive,
} from "@/src/lib/console-buffer.ts";
import { refreshDevMetricsGate } from "@/src/lib/dev-metrics.ts";
import {
	getMcpBridgeStatus,
	type McpBridgeStatus,
	mcpBridgeConfigSnippet,
} from "@/src/lib/mcp-bridge.ts";
import { copyDiagnostics } from "@/src/lib/preflight.ts";
import { DevMetricsPanel } from "./DevMetricsPanel.tsx";
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
	// Prerelease-only daily wipe. `supported` is decided in Rust from the running
	// build's PROFILE, never from the release-channel preference — that one is a
	// user-settable updater feed, and a stable user pointing it at "Canary" must
	// not be offered a delete of their real data folder.
	const midnightWipe = useMidnightWipe();

	const target: ApiTarget = {
		url: activeNode.url,
		token: activeNode.token ?? null,
	};

	// When the user enables developer mode, activate console capture immediately
	// so the buffer starts filling without a reload.
	const handleToggleDevMode = useCallback(
		(next: boolean) => {
			setDevMode(next);
			// Same reason console capture is installed here: the metrics gate caches
			// its answer so a disabled recorder costs one branch, which means the flip
			// has to invalidate it or recording would not start until a reload.
			refreshDevMetricsGate();
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
				caption="Enables debug tools for troubleshooting in production builds: visual annotation toolbar, console capture on crash, and one-click diagnostics. Your choice is remembered on this device."
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
										? "Capturing. Up to 500 entries are kept in memory."
										: "Not yet active. It activates on next reload or when you toggle Developer Mode on."
								}
								title="Console buffer status"
							/>
						</SettingsGroup>
					</SettingsSection>

					<DevMetricsPanel />

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
									? `Listening on ${bridge.host}:${bridge.port}. This socket accepts any local connection without a credential, and a page open in your browser counts as local, so restart Ryu to close it when you are done.`
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
								description={`Paste this into your agent's MCP config and attach on port ${bridge.port}. The protocol carries no bearer token, so the port is the whole connection detail, so treat it as a credential and keep it off shared machines.`}
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

			{/* Prerelease builds only. OUTSIDE the Developer Mode gate on purpose:
			    this one deletes data, so the switch that turns it OFF must never
			    be reachable only through a second toggle. `supported` is false on
			    stable and dev builds, where the row is hidden rather than disabled
			    because there is no isolated data folder for it to act on. */}
			{midnightWipe.status?.supported ? (
				<SettingsSection
					caption={`Returns this ${channelLabel(midnightWipe.status.profile)} build to a just-installed state on the first launch of each day, so first-run and onboarding paths get exercised the way a new user meets them. Off by default, stored outside the folder it clears, and it never touches your stable install.`}
					title="Daily data reset"
				>
					<SettingsGroup>
						<SettingsItem
							actions={
								<Switch
									checked={midnightWipe.status.enabled}
									id="midnight-wipe"
									onCheckedChange={(next) => {
										midnightWipe.setEnabled(next).then((applied) => {
											if (!applied) {
												toast.error("Couldn't save that setting");
												return;
											}
											toast.success(
												next
													? "Daily reset on. This build's data folder clears at the first launch after midnight"
													: "Daily reset off"
											);
										});
									}}
								/>
							}
							description={`Deletes everything in ${midnightWipe.status.data_dir} (chats, agents, spaces, installed apps and downloads) at the first launch after midnight. Your encryption key survives so the node still boots, and several missed days still clear it exactly once.${midnightWipe.status.last_wipe_date ? ` Last cleared ${midnightWipe.status.last_wipe_date}.` : ""}`}
							title="Wipe this data folder at midnight"
						/>
						{midnightWipe.error ? (
							<SettingsItem
								description={midnightWipe.error}
								title="Couldn't save that setting"
							/>
						) : null}
					</SettingsGroup>
				</SettingsSection>
			) : null}
		</div>
	);
}
