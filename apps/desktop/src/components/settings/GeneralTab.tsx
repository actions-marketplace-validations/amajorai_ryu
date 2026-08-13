import { Button } from "@ryu/ui/components/button.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select.tsx";
import { toast } from "@ryu/ui/components/sileo.tsx";
import { Switch } from "@ryu/ui/components/switch.tsx";
import { invoke } from "@tauri-apps/api/core";
import {
	disable as disableAutostart,
	enable as enableAutostart,
	isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TAB_UNLOAD_MINUTES_KEY } from "@/src/contexts/TabsContext.tsx";
import { useAutoHideTitleBar } from "@/src/hooks/useAutoHideTitleBar.ts";
import { useAutoImportThreads } from "@/src/hooks/useAutoImportThreads.ts";
import {
	setNodeTabOverride,
	useNodeTabOverride,
} from "@/src/hooks/useNodeDisplayMode.ts";
import { usePersistedNumber } from "@/src/hooks/usePersistedNumber.ts";
import {
	type QueueDrainMode,
	setQueueDrainMode,
	useQueueDrainMode,
} from "@/src/hooks/useQueueDrainMode.ts";
import {
	type StartupBehavior,
	setStartupBehavior,
	useStartupBehavior,
} from "@/src/hooks/useStartupBehavior.ts";
import { setTabLayout, useTabLayout } from "@/src/hooks/useTabLayout.ts";
import {
	setTabOpenBehavior,
	useTabOpenBehavior,
} from "@/src/hooks/useTabOpenBehavior.ts";
import { setTabSizing, useTabSizing } from "@/src/hooks/useTabSizing.ts";
import {
	setTabSwitchBehavior,
	type TabSwitchBehavior,
	useTabSwitchBehavior,
} from "@/src/hooks/useTabSwitchBehavior.ts";
import { STORAGE_KEYS } from "@/src/lib/themes/presets.ts";
import { useWorkspaceStore } from "@/src/store/useWorkspaceStore.ts";
import { SafeModeSettings } from "./SafeModeSettings.tsx";
import { SplitPresetSettings } from "./SplitPresetSettings.tsx";
import {
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

// What the window opens on at launch — a Chrome-style "On startup" choice.
const STARTUP_OPTIONS: { value: StartupBehavior; label: string }[] = [
	{ value: "empty", label: "The launchpad (no tabs)" },
	{ value: "home", label: "The Home page" },
	{ value: "chat", label: "A new chat" },
	{ value: "restore", label: "Reopen previous tabs" },
];

// How the message queue drains while an agent is still responding.
const QUEUE_DRAIN_OPTIONS: { value: QueueDrainMode; label: string }[] = [
	{ value: "oldest-first", label: "Oldest first" },
	{ value: "latest-first", label: "Latest first" },
	{ value: "send-all", label: "Send all together" },
];

// Which shell the built-in terminal and git actions run their commands through.
// "auto" lets the Rust side pick the OS default; every other value is an
// allowlisted shell name understood by the `shell_execute` command.
const TERMINAL_SHELL_OPTIONS = [
	{ value: "auto", label: "Auto (OS default)" },
	{ value: "bash", label: "Bash" },
	{ value: "zsh", label: "Zsh" },
	{ value: "sh", label: "sh" },
	{ value: "fish", label: "Fish" },
	{ value: "powershell", label: "PowerShell" },
	{ value: "pwsh", label: "pwsh" },
	{ value: "cmd", label: "cmd" },
];

// Minute thresholds offered for auto-unloading inactive tabs. 0 disables it.
const TAB_UNLOAD_OPTIONS = [
	{ value: "0", label: "Never" },
	{ value: "5", label: "After 5 minutes" },
	{ value: "10", label: "After 10 minutes" },
	{ value: "15", label: "After 15 minutes" },
	{ value: "30", label: "After 30 minutes" },
	{ value: "60", label: "After 1 hour" },
];

// Ctrl/Cmd+Tab cycle order — sequential strip order (default) or MRU.
const TAB_SWITCH_OPTIONS: { value: TabSwitchBehavior; label: string }[] = [
	{ value: "sequential", label: "In order (left to right)" },
	{ value: "recent", label: "Most recently used" },
];

export function GeneralTab() {
	const navigate = useNavigate();
	const tabOverrideEnabled = useNodeTabOverride();
	const tabLayout = useTabLayout();
	const tabSizing = useTabSizing();
	const [autoHideTitleBar, setAutoHideTitleBar] = useAutoHideTitleBar();
	const tabOpenBehavior = useTabOpenBehavior();
	const tabSwitchBehavior = useTabSwitchBehavior();
	const startupBehavior = useStartupBehavior();
	const queueDrainMode = useQueueDrainMode();
	const terminalShell = useWorkspaceStore((s) => s.terminalShell);
	const setTerminalShell = useWorkspaceStore((s) => s.setTerminalShell);
	const [autoImportThreads, setAutoImportThreads] = useAutoImportThreads();
	const [tabUnloadMinutes, setTabUnloadMinutes] = usePersistedNumber(
		TAB_UNLOAD_MINUTES_KEY,
		0
	);

	// "Hide tray icon" is persisted in the desktop process (tauri-plugin-store)
	// so it can be read at startup before Core is up. Disabled by default — the
	// icon shows in the tray / menu bar unless the user opts out.
	const [hideTrayIcon, setHideTrayIcon] = useState(false);
	// "Stay in the tray when closed" lives in the same desktop-process store and
	// is ON by default, so seed it optimistically to true — reading it back false
	// for a frame would flash the toggle off on every open.
	const [closeToTray, setCloseToTray] = useState(true);
	useEffect(() => {
		invoke<boolean>("get_hide_tray_icon")
			.then(setHideTrayIcon)
			.catch(() => {
				// Non-Tauri context or command unavailable: keep the default.
			});
		invoke<boolean>("get_close_to_tray")
			.then(setCloseToTray)
			.catch(() => {
				// Non-Tauri context or command unavailable: keep the default.
			});
	}, []);

	// "Launch at login" is an OS registration (macOS LaunchAgent, Windows Run key,
	// Linux ~/.config/autostart), so the OS — not a local mirror — is the source
	// of truth: seed the toggle from the plugin. "Start hidden" is a local desktop
	// preference read during startup, and only applies to a login-launched
	// instance, so a manual launch is always visible.
	const [launchAtLogin, setLaunchAtLogin] = useState(false);
	const [startHidden, setStartHidden] = useState(false);
	useEffect(() => {
		isAutostartEnabled()
			.then(setLaunchAtLogin)
			.catch(() => {
				// Non-Tauri context or unsupported platform: keep the default.
			});
		invoke<boolean>("get_start_hidden")
			.then(setStartHidden)
			.catch(() => {
				// Non-Tauri context or command unavailable: keep the default.
			});
	}, []);

	const handleLaunchAtLogin = async (enabled: boolean) => {
		setLaunchAtLogin(enabled);
		try {
			await (enabled ? enableAutostart() : disableAutostart());
		} catch {
			setLaunchAtLogin(!enabled);
			toast.error("Couldn't update the launch-at-login setting", {
				description:
					"Your change wasn't saved. You may need to allow Ryu to start at login in your system settings.",
			});
		}
	};

	const handleStartHidden = async (hidden: boolean) => {
		setStartHidden(hidden);
		try {
			await invoke("set_start_hidden", { hidden });
		} catch {
			setStartHidden(!hidden);
			toast.error("Couldn't update the start-hidden setting", {
				description: "Your change wasn't saved. Please try again.",
			});
		}
	};

	const handleCloseToTray = async (enabled: boolean) => {
		setCloseToTray(enabled);
		try {
			await invoke("set_close_to_tray", { enabled });
		} catch {
			setCloseToTray(!enabled);
			toast.error("Couldn't update the close-to-tray setting", {
				description: "Your change wasn't saved. Please try again.",
			});
		}
	};

	const handleHideTrayIcon = async (hidden: boolean) => {
		setHideTrayIcon(hidden);
		try {
			await invoke("set_hide_tray_icon", { hidden });
		} catch {
			// Revert the optimistic toggle if the command failed.
			setHideTrayIcon(!hidden);
			toast.error("Couldn't update the tray icon setting", {
				description: "Your change wasn't saved. Please try again.",
			});
		}
	};

	const resetOnboarding = () => {
		for (const key of [
			"ryu_onboarding_complete",
			"ryu_setup_seen",
			"ryu_default_agent",
			STORAGE_KEYS.lightPreset,
			STORAGE_KEYS.darkPreset,
			STORAGE_KEYS.uiFont,
			STORAGE_KEYS.headingFont,
			STORAGE_KEYS.codeFont,
			STORAGE_KEYS.contrast,
			STORAGE_KEYS.radius,
			STORAGE_KEYS.spacing,
			STORAGE_KEYS.scale,
			STORAGE_KEYS.cardSpacing,
			STORAGE_KEYS.chatWidth,
		]) {
			localStorage.removeItem(key);
		}
		navigate("/onboarding");
	};

	return (
		<div className="space-y-6">
			<SettingsSection
				caption="What Ryu opens when you launch it."
				title="On startup"
			>
				<SettingsGroup>
					<SettingsItem
						actions={
							<Select
								items={STARTUP_OPTIONS}
								onValueChange={(v) => setStartupBehavior(v as StartupBehavior)}
								value={startupBehavior}
							>
								<SelectTrigger
									className="h-8 w-56 flex-shrink-0 text-sm"
									id="startup-behavior-select"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{STARTUP_OPTIONS.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						}
						description="Choose what opens when the window launches: a clean launchpad with no tabs, the Home page, a new chat, or the tabs you had open last time."
						title="Open with"
					/>
				</SettingsGroup>
			</SettingsSection>

			<SettingsSection
				caption="How open tabs are shown and managed."
				title="Tabs"
			>
				<SettingsGroup>
					<SettingsItem
						actions={
							<Switch
								checked={tabOpenBehavior === "current"}
								id="open-in-current-tab-toggle"
								onCheckedChange={(checked) =>
									setTabOpenBehavior(checked ? "current" : "new")
								}
							/>
						}
						description="Open pages from the sidebar and command palette in the tab you're already on instead of a new tab each time. Pinned and split tabs are never replaced, and you can still open a new tab any time — middle-click a sidebar item, use its “Open in new tab” menu, or the + button."
						title="Open links in the current tab"
					/>
					<SettingsItem
						actions={
							<Select
								items={TAB_SWITCH_OPTIONS}
								onValueChange={(v) =>
									setTabSwitchBehavior(v as TabSwitchBehavior)
								}
								value={tabSwitchBehavior}
							>
								<SelectTrigger
									className="h-8 w-56 flex-shrink-0 text-sm"
									id="tab-switch-behavior-select"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{TAB_SWITCH_OPTIONS.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						}
						description="Ctrl/Cmd+Tab and Ctrl/Cmd+Shift+Tab cycle open tabs. In order walks the tab strip left to right; most recently used jumps between tabs you've viewed lately (hold the modifier and press Tab repeatedly to keep cycling)."
						title="Switch tabs with Ctrl/Cmd+Tab"
					/>
					<SettingsItem
						actions={
							<Switch
								checked={tabLayout === "vertical"}
								id="vertical-tabs-toggle"
								onCheckedChange={(checked) =>
									setTabLayout(checked ? "vertical" : "horizontal")
								}
							/>
						}
						description="Show open tabs as a collapsible list in the left sidebar (Zen-browser style) instead of a horizontal bar at the top."
						title="Vertical tabs"
					/>
					<SettingsItem
						actions={
							<Switch
								checked={autoHideTitleBar}
								id="auto-hide-titlebar-toggle"
								onCheckedChange={setAutoHideTitleBar}
							/>
						}
						description="Tuck the title bar and tab strip away until you move the cursor near the top of the window, like the floating sidebar peek. Off by default — the bar stays docked and always visible."
						title="Auto-hide title bar"
					/>
					<SettingsItem
						actions={
							<Switch
								checked={tabSizing === "fit"}
								disabled={tabLayout === "vertical"}
								id="fit-tabs-toggle"
								onCheckedChange={(checked) =>
									setTabSizing(checked ? "fit" : "fixed")
								}
							/>
						}
						description="Shrink open tabs equally to share the available width (Chrome-style) instead of keeping each a fixed size and scrolling the bar when they overflow. Only applies to the horizontal tab bar."
						title="Fit tabs to width"
					/>
					<SettingsItem
						actions={
							<Select
								items={TAB_UNLOAD_OPTIONS}
								onValueChange={(v) => setTabUnloadMinutes(Number(v))}
								value={String(tabUnloadMinutes)}
							>
								<SelectTrigger
									className="h-8 w-40 flex-shrink-0 text-sm"
									id="tab-unload-select"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{TAB_UNLOAD_OPTIONS.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						}
						description="Free memory by unloading tabs you haven't viewed for a while. An unloaded tab reloads when you click it; pinned and active tabs are never unloaded."
						title="Unload inactive tabs"
					/>
					<SettingsItem
						actions={
							<Switch
								checked={tabOverrideEnabled}
								id="tab-override-toggle"
								onCheckedChange={setNodeTabOverride}
							/>
						}
						description="Each tab can connect to a different node independently."
						title="Per-tab node override"
					/>
				</SettingsGroup>
			</SettingsSection>

			{/* Split-view layout presets: captured from the split's own context
			    menu, renamed or deleted here. */}
			<SplitPresetSettings />

			<SettingsSection
				caption="How Ryu surfaces your agents' own chat history."
				title="Chats"
			>
				<SettingsGroup>
					<SettingsItem
						actions={
							<Switch
								checked={autoImportThreads}
								id="auto-import-threads-toggle"
								onCheckedChange={setAutoImportThreads}
							/>
						}
						description="Automatically import threads from your agents' own on-disk history (Claude Code, Codex…) into Ryu and keep them in sync — new threads appear on their own, each filed under the project folder it ran in. Ryu rescans on launch, on a timer, and when the window regains focus. You can always import manually from the Chats section or the launchpad."
						title="Auto-import agent threads"
					/>
					<SettingsItem
						actions={
							<Select
								items={QUEUE_DRAIN_OPTIONS}
								onValueChange={(v) => setQueueDrainMode(v as QueueDrainMode)}
								value={queueDrainMode}
							>
								<SelectTrigger
									className="h-8 w-56 flex-shrink-0 text-sm"
									id="queue-drain-mode-select"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{QUEUE_DRAIN_OPTIONS.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						}
						description="When you send messages while an agent is still replying, they wait in a queue and drain one per turn. Choose which goes next: the oldest waiting message (first in, first out), the latest one you typed (jump the line with a correction), or collapse the whole queue into a single combined turn."
						title="Queued messages send"
					/>
				</SettingsGroup>
			</SettingsSection>

			<SettingsSection
				caption="How the built-in terminal and git actions run commands."
				title="Terminal"
			>
				<SettingsGroup>
					<SettingsItem
						actions={
							<Select
								items={TERMINAL_SHELL_OPTIONS}
								onValueChange={setTerminalShell}
								value={terminalShell}
							>
								<SelectTrigger
									className="h-8 w-56 flex-shrink-0 text-sm"
									id="terminal-shell-select"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{TERMINAL_SHELL_OPTIONS.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						}
						description="Which shell the built-in terminal and git actions use. Auto picks the OS default (PowerShell on Windows, Bash elsewhere)."
						title="Terminal shell"
					/>
				</SettingsGroup>
			</SettingsSection>

			<SettingsSection
				caption="How Ryu appears in the system tray and runs in the background."
				title="System"
			>
				<SettingsGroup>
					<SettingsItem
						actions={
							<Switch
								checked={launchAtLogin}
								id="launch-at-login-toggle"
								onCheckedChange={handleLaunchAtLogin}
							/>
						}
						description="Start Ryu automatically when you sign in to your computer, so your agents and background work are ready without opening it yourself. Works on macOS, Windows, and Linux."
						title="Start Ryu on startup"
					/>
					<SettingsItem
						actions={
							<Switch
								checked={startHidden}
								disabled={!launchAtLogin}
								id="start-hidden-toggle"
								onCheckedChange={handleStartHidden}
							/>
						}
						description="When Ryu starts at login, run it in the background with no window on screen — open it later from the tray icon, the dock or taskbar, or its global shortcut. Launching Ryu yourself always opens the window."
						title="Start hidden"
					/>
					<SettingsItem
						actions={
							<Switch
								checked={closeToTray && !hideTrayIcon}
								disabled={hideTrayIcon}
								id="close-to-tray-toggle"
								onCheckedChange={handleCloseToTray}
							/>
						}
						description="Closing the window leaves Ryu running in the tray instead of quitting, so background agents and running turns keep going. Quit from the tray menu to stop it completely. Ignored while the tray icon is hidden — there would be no way back to the window."
						title="Stay in tray on close"
					/>
					<SettingsItem
						actions={
							<Switch
								checked={hideTrayIcon}
								id="hide-tray-icon-toggle"
								onCheckedChange={handleHideTrayIcon}
							/>
						}
						description="Remove the Ryu icon from the system tray (the menu bar on macOS). Ryu keeps running in the background and you can still open it from the taskbar, dock, or its global shortcut."
						title="Hide tray icon"
					/>
				</SettingsGroup>
			</SettingsSection>

			<SettingsSection title="Setup">
				<SettingsGroup>
					<SettingsItem
						actions={
							<Button onClick={resetOnboarding} size="sm" variant="ghost">
								Reset onboarding
							</Button>
						}
						description="Restart the first-run setup flow. This also clears your saved theme, typography, and layout preferences."
						title="Onboarding"
					/>
				</SettingsGroup>
			</SettingsSection>

			{/* Last, and node-scoped rather than app-scoped: everything above is a
			    preference about this window, while Safe Mode changes what the node
			    itself loads on its next boot. */}
			<SafeModeSettings />
		</div>
	);
}
