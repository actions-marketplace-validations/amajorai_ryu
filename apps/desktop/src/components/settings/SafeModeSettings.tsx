// apps/desktop/src/components/settings/SafeModeSettings.tsx
//
// The Safe Mode switch — the OS-style "boot with the extension layer off" mode,
// for isolating a performance problem in one step instead of disabling thirty
// things one at a time.
//
// Deliberately NOT behind Developer Mode. The user reaching for this is chasing a
// hang or a fan spinning up, and that user is usually not a developer; gating it
// would put the troubleshooting tool behind a switch nobody in trouble knows to
// find. It lives under General → Troubleshooting for that reason.
//
// Restart-on-apply is the honest behaviour, not a shortcut. Suppression happens at
// Core's BOOT, before anything spawns; a live flip would leave every sidecar, MCP
// child and scheduler loop that already started still running, so the switch would
// report success while the CPU cost it exists to remove kept being paid. The copy
// says so rather than hiding it.

import { Button } from "@ryu/ui/components/button.tsx";
import { toast } from "@ryu/ui/components/sileo.tsx";
import { Switch } from "@ryu/ui/components/switch.tsx";
import { useCallback, useEffect, useState } from "react";
import { restartRyuCore } from "@/lib/tauri-bridge.ts";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	applySafeMode,
	fetchSafeMode,
	readSafeModeSentinel,
	type SafeModeState,
} from "@/src/lib/api/safe-mode.ts";
import {
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

/** "3 apps, 12 skills and 2 MCP servers" — the empty parts are dropped. */
function describeSuppressed(state: SafeModeState): string {
	const { mcpServers, plugins, skills } = state.suppressed;
	const parts: string[] = [];
	if (plugins > 0) {
		parts.push(`${plugins} app${plugins === 1 ? "" : "s"}`);
	}
	if (skills > 0) {
		parts.push(`${skills} skill${skills === 1 ? "" : "s"}`);
	}
	if (mcpServers > 0) {
		parts.push(`${mcpServers} MCP server${mcpServers === 1 ? "" : "s"}`);
	}
	if (parts.length === 0) {
		return "nothing";
	}
	if (parts.length === 1) {
		return parts[0];
	}
	return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

function statusLine(state: SafeModeState): string {
	const scope = describeSuppressed(state);
	if (state.enabled) {
		return state.source === "env"
			? `Active, forced on by the RYU_SAFE_MODE environment variable. Holding back ${scope}.`
			: `Active. Holding back ${scope}. Your apps are untouched; turning this off restores them exactly.`;
	}
	return `Off. Turning it on would start the node without ${scope}.`;
}

export function SafeModeSettings() {
	const activeNode = useActiveNode();
	const [state, setState] = useState<SafeModeState | null>(null);
	const [busy, setBusy] = useState(false);
	// The sentinel read, which works with Core down. `null` = not resolved yet.
	const [sentinel, setSentinel] = useState<boolean | null>(null);

	const target: ApiTarget = {
		token: activeNode.token ?? null,
		url: activeNode.url,
	};
	const targetUrl = target.url;
	const targetToken = target.token;

	const refresh = useCallback(async () => {
		// The sentinel first, because it is the read that survives a Core that will
		// not answer — which is the state a user reaching for Safe Mode is often in.
		setSentinel(await readSafeModeSentinel());
		try {
			setState(await fetchSafeMode({ token: targetToken, url: targetUrl }));
		} catch {
			// An unreachable node is exactly the situation this panel is for, so a
			// failed read must not blank the section — the switch falls back to the
			// sentinel and stays usable.
			setState(null);
		}
	}, [targetToken, targetUrl]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const handleToggle = useCallback(
		async (next: boolean) => {
			setBusy(true);
			try {
				// Core when it is up (it owns both persistence tiers), the on-disk
				// sentinel when it is not — so a node that will not answer can still
				// be brought up safe.
				await applySafeMode(target, next);
				toast.success(
					next
						? "Safe Mode armed — restarting the node"
						: "Safe Mode cleared — restarting the node"
				);
				// The write already persisted to BOTH tiers (preference + sentinel), so
				// even if this restart fails the next launch is correct.
				await restartRyuCore().catch(() => undefined);
				await refresh();
			} catch (e) {
				toast.error(
					e instanceof Error ? e.message : "Couldn't change Safe Mode"
				);
			} finally {
				setBusy(false);
			}
		},
		[refresh, target]
	);

	// Core's effective answer wins; the sentinel is the fallback when it is silent.
	const enabled = state?.enabled ?? sentinel ?? false;
	// An env-forced node cannot be talked out of Safe Mode from here (Core answers
	// 409), so the switch is disabled rather than offered and then refused.
	const locked = busy || (enabled && state?.userClearable === false);

	return (
		<SettingsSection
			caption="Starts the node with apps, plugins, skills, your MCP servers and the scheduler switched off, so you can tell whether one of them is what's slow. Chat, agents and settings keep working. Nothing is uninstalled or reconfigured; this only changes what loads."
			title="Troubleshooting"
		>
			<SettingsGroup>
				<SettingsItem
					actions={
						<Switch
							checked={enabled}
							disabled={locked}
							id="safe-mode"
							onCheckedChange={handleToggle}
						/>
					}
					description={
						state
							? `${statusLine(state)} Applies on restart; the node restarts when you flip this.`
							: `The node isn't answering, so this reads the on-disk flag instead: Safe Mode is ${enabled ? "armed" : "off"} for its next boot.`
					}
					title="Safe Mode"
				/>
				{state?.enabled && state.source !== "env" ? (
					<SettingsItem
						actions={
							<Button
								disabled={busy}
								onClick={() => handleToggle(false)}
								size="sm"
								variant="ghost"
							>
								Leave Safe Mode
							</Button>
						}
						description={`${state.suppressed.kernelPlugins} core plugin${state.suppressed.kernelPlugins === 1 ? "" : "s"} kept running so chat and retrieval still work. Leaving restarts the node and brings everything back.`}
						title="Back to a normal boot"
					/>
				) : null}
			</SettingsGroup>
		</SettingsSection>
	);
}
