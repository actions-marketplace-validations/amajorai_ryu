"use client";

// Presentational layer of the desktop Updates settings tab. The live app
// (`apps/desktop/src/components/settings/UpdatesSettings.tsx`) is a thin
// container that talks to Core's update API; the storyboard renders the same
// component with mock data. One source of truth, so editing this block changes
// the real desktop too.

import {
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "@ryu/blocks/desktop/settings-items";
import { Button } from "@ryu/ui/components/button";
import { Switch } from "@ryu/ui/components/switch";

export interface UpdatesViewProps {
	autoUpdate?: boolean;
	checking?: boolean;
	onCheck?: () => void;
	/** Called when the owner asks to manage/extend their updates window. Renders
	 *  the action button only when supplied. */
	onManageUpdates?: () => void;
	onToggle?: (next: boolean) => void;
	/**
	 * Set only for a lifetime owner: states through when updates are included, and —
	 * once something is actually being withheld — how to get another year. Absent
	 * for everyone else, which leaves this tab exactly as it renders today.
	 */
	updatesWindowNotice?: string;
	version?: string | null;
}

export function UpdatesView({
	version,
	autoUpdate = true,
	checking,
	onToggle,
	onCheck,
	onManageUpdates,
	updatesWindowNotice,
}: UpdatesViewProps) {
	return (
		<div className="space-y-6">
			<SettingsSection
				caption={version ? `Current version: v${version}.` : undefined}
				title="Software updates"
			>
				<SettingsGroup>
					<SettingsItem
						actions={
							<Switch
								aria-label="Toggle automatic updates"
								checked={autoUpdate}
								onCheckedChange={onToggle}
							/>
						}
						description="Check for updates on launch and install them automatically."
						title="Automatic updates"
					/>
					<SettingsItem
						actions={
							<Button
								disabled={checking}
								onClick={onCheck}
								size="sm"
								variant="outline"
							>
								{checking ? "Checking…" : "Check for updates"}
							</Button>
						}
						description="Manually check for a new release now."
						title="Check for updates"
					/>
					{updatesWindowNotice ? (
						<SettingsItem
							actions={
								onManageUpdates ? (
									<Button onClick={onManageUpdates} size="sm" variant="outline">
										Extend updates
									</Button>
								) : undefined
							}
							description={updatesWindowNotice}
							title="Lifetime updates"
						/>
					) : null}
				</SettingsGroup>
			</SettingsSection>
		</div>
	);
}
