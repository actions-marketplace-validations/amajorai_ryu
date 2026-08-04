// The onboarding general-settings step. It is deliberately the same knobs the
// Settings → General / Appearance panels lead with (inset sidebar, pointer
// cursor, start-at-login) driven through the *same* setters, so whatever the
// user picks here is already persisted by the time onboarding finishes — there
// is no separate onboarding preference state to reconcile later.
//
// "Start Ryu on startup" is an OS registration (macOS LaunchAgent, Windows Run
// key, Linux ~/.config/autostart), so the OS — not a local mirror — is the
// source of truth: seed the toggle from the plugin and revert on write failure,
// exactly as the General tab does.

import { Button } from "@ryu/ui/components/button";
import { Logo as GhostOrb } from "@ryu/ui/components/logo";
import { PageHeader } from "@ryu/ui/components/page-header";
import { toast } from "@ryu/ui/components/sileo";
import { StaggerReveal } from "@ryu/ui/components/stagger-reveal";
import { Switch } from "@ryu/ui/components/switch";
import {
	disable as disableAutostart,
	enable as enableAutostart,
	isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import {
	SettingsGroup,
	SettingsItem,
} from "@/src/components/settings/shared/settings-items.tsx";
import {
	setPointerCursor,
	usePointerCursor,
} from "@/src/hooks/usePointerCursor.ts";
import { useSidebarVariant } from "@/src/hooks/useSidebarVariant.ts";

interface PreferencesStepProps {
	/** Onboarding is finishing; the step locks so the user can't double-submit. */
	busy?: boolean;
	onContinue: () => void;
}

export function PreferencesStep({
	busy = false,
	onContinue,
}: PreferencesStepProps) {
	const [sidebarVariant, setSidebarVariant] = useSidebarVariant();
	const pointerCursorEnabled = usePointerCursor();
	const [launchAtLogin, setLaunchAtLogin] = useState(false);

	// "Start Ryu on startup" lives in the OS, not in a local mirror — seed the
	// toggle from the plugin (non-Tauri contexts keep the default off).
	useEffect(() => {
		isAutostartEnabled()
			.then(setLaunchAtLogin)
			.catch(() => {
				// Non-Tauri context or unsupported platform: keep the default.
			});
	}, []);

	const handleLaunchAtLogin = async (enabled: boolean) => {
		setLaunchAtLogin(enabled);
		try {
			await (enabled ? enableAutostart() : disableAutostart());
		} catch {
			// Revert the optimistic toggle if the OS registration failed.
			setLaunchAtLogin(!enabled);
			toast.error({
				title: "Couldn't update the launch-at-login setting",
				description:
					"Your change wasn't saved. You may need to allow Ryu to start at login in your system settings.",
			});
		}
	};

	return (
		// Mirrors the shared OnboardingShell: the outer box owns the scroll and the
		// inner column uses `min-h-full` so it centres when it fits and grows when it
		// doesn't (the page wrapper is `h-screen overflow-hidden`).
		<div className="h-full w-full overflow-y-auto">
			<div
				className="flex min-h-full w-full flex-col items-center justify-center gap-8 p-8"
				data-tauri-drag-region="true"
			>
				<StaggerReveal>
					<div className="shrink-0">
						<GhostOrb size="50px" variant="outline" />
					</div>
					<PageHeader
						subtitle="A few general settings to start with. You can change any of them later in Settings."
						title="Set your preferences"
					/>

					<div className="flex w-full max-w-md flex-col gap-6">
						<SettingsGroup>
							<SettingsItem
								actions={
									<Switch
										checked={sidebarVariant === "inset"}
										id="onboarding-inset-sidebar"
										onCheckedChange={(checked) =>
											setSidebarVariant(checked ? "inset" : "floating")
										}
									/>
								}
								description="Sit the sidebar flush against the window edge and pull the main content in as its own rounded card. Turn off to float the sidebar as a rounded card over a flush canvas."
								title="Inset sidebar"
							/>
							<SettingsItem
								actions={
									<Switch
										checked={pointerCursorEnabled}
										id="onboarding-pointer-cursor"
										onCheckedChange={setPointerCursor}
									/>
								}
								description="Show a pointer cursor when hovering over interactive elements."
								title="Pointer cursor"
							/>
							<SettingsItem
								actions={
									<Switch
										checked={launchAtLogin}
										id="onboarding-launch-at-login"
										onCheckedChange={handleLaunchAtLogin}
									/>
								}
								description="Start Ryu automatically when you sign in to your computer, so your agents and background work are ready without opening it yourself."
								title="Start Ryu on startup"
							/>
						</SettingsGroup>

						<div className="flex items-center justify-end">
							<Button
								disabled={busy}
								onClick={onContinue}
								size="lg"
								variant="mono"
							>
								{busy ? "Finishing…" : "Continue"}
							</Button>
						</div>
					</div>
				</StaggerReveal>
			</div>
		</div>
	);
}
