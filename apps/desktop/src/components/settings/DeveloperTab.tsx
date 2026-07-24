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
import { copyDiagnostics } from "@/src/lib/preflight.ts";
import {
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

export function DeveloperTab() {
	const [devMode, setDevMode] = useDeveloperMode();
	const [consoleActive, setConsoleActive] = useState(isConsoleCaptureActive);
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
		</div>
	);
}
