import {
	AGENT_AVAILABILITY_OPTIONS,
	agentAvailabilityLabel,
} from "@ryu/blocks/desktop/agent-availability";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select.tsx";
import { Switch } from "@ryu/ui/components/switch.tsx";
import { useUserAvailability } from "@/src/hooks/useUserAvailability.ts";
import {
	AFK_TIMEOUT_OPTIONS,
	type AfkTimeoutMinutes,
} from "@/src/lib/user-availability.ts";
import {
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

const AFK_TIMEOUT_SELECT_OPTIONS = AFK_TIMEOUT_OPTIONS.map((minutes) => ({
	label: minutes === 60 ? "After 1 hour" : `After ${minutes} minutes`,
	value: String(minutes),
}));

/** General settings for human-input timing and AFK detection. */
export function AvailabilitySettings() {
	const {
		settings,
		setAfkDetection,
		setAfkTimeout,
		setStatus,
		status,
		source,
	} = useUserAvailability();

	return (
		<SettingsSection
			caption="Tell Ryu when it can ask for a decision. Manual status always wins; AFK detection only turns Online into Away."
			title="Availability & prompts"
		>
			<SettingsGroup>
				<SettingsItem
					actions={
						<Select
							items={AGENT_AVAILABILITY_OPTIONS}
							onValueChange={(value) => {
								if (
									value === "online" ||
									value === "away" ||
									value === "do-not-disturb"
								) {
									setStatus(value);
								}
							}}
							value={settings.manualStatus}
						>
							<SelectTrigger
								className="h-8 w-44 flex-shrink-0 text-sm"
								id="availability-manual-status-select"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{AGENT_AVAILABILITY_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					}
					description={`Currently ${agentAvailabilityLabel(status)}${source === "afk" ? " from AFK detection" : " by your choice"}.`}
					settingsId="general.chats.manual-status"
					title="Manual status"
				/>
				<SettingsItem
					actions={
						<Switch
							checked={settings.afkDetectionEnabled}
							id="availability-afk-detection-toggle"
							onCheckedChange={setAfkDetection}
						/>
					}
					description="When enabled, an unfocused or idle Ryu window becomes Away automatically. Returning to the window marks it Online again when your manual status is Online."
					settingsId="general.chats.afk-detection"
					title="Auto-away when inactive"
				/>
				<SettingsItem
					actions={
						<Select
							disabled={!settings.afkDetectionEnabled}
							items={AFK_TIMEOUT_SELECT_OPTIONS}
							onValueChange={(value) => {
								const minutes = Number(value);
								if (
									AFK_TIMEOUT_OPTIONS.includes(minutes as AfkTimeoutMinutes)
								) {
									setAfkTimeout(minutes as AfkTimeoutMinutes);
								}
							}}
							value={String(settings.afkTimeoutMinutes)}
						>
							<SelectTrigger
								className="h-8 w-44 flex-shrink-0 text-sm"
								id="availability-afk-timeout-select"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{AFK_TIMEOUT_SELECT_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					}
					description="Choose how long an Online window can be idle before prompts stop taking over the composer."
					settingsId="general.chats.afk-timeout"
					title="Auto-away after"
				/>
			</SettingsGroup>
		</SettingsSection>
	);
}
