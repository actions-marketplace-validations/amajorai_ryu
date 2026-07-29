// Thin container for the Updates settings tab. Talks to Core's unified updater
// (version + shared auto-update toggle + manual check) and renders the shared
// presentational `UpdatesView` (`@ryu/blocks/desktop/updates`) — the same view
// the storyboard renders with mock data.

import { UpdatesView } from "@ryu/blocks/desktop/updates.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select.tsx";
import { useEffect, useState } from "react";
import { sileo } from "sileo";
import { useActiveNodeGetter } from "@/src/hooks/useActiveNode.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	checkForUpdate,
	FORCE_AUTO_UPDATE,
	getAutoUpdateEnabled,
	getVersionInfo,
	setAutoUpdateEnabled,
	updateCheckFailed,
} from "@/src/lib/api/update.ts";
import {
	RELEASE_CHANNELS,
	type ReleaseChannel,
	useReleaseChannel,
} from "@/src/lib/release-channel.ts";
import {
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

export function UpdatesSettings() {
	const getNode = useActiveNodeGetter();
	const [version, setVersion] = useState<string | null>(null);
	const [autoUpdate, setAutoUpdate] = useState<boolean>(true);
	const [checking, setChecking] = useState(false);

	useEffect(() => {
		const target = toTarget(getNode());
		let active = true;
		void (async () => {
			const [info, enabled] = await Promise.all([
				getVersionInfo(target).catch(() => null),
				getAutoUpdateEnabled(target),
			]);
			if (!active) {
				return;
			}
			setVersion(info?.ryu_version ?? null);
			setAutoUpdate(enabled);
		})();
		return () => {
			active = false;
		};
	}, [getNode]);

	const onToggle = async (next: boolean) => {
		setAutoUpdate(next);
		const ok = await setAutoUpdateEnabled(toTarget(getNode()), next);
		if (!ok) {
			setAutoUpdate(!next);
			sileo.error({ title: "Could not save the auto-update setting" });
		}
	};

	const onCheck = async () => {
		setChecking(true);
		try {
			const verdict = await checkForUpdate(toTarget(getNode()));
			// A failed check surfaces as either the fail-soft sentinel (empty
			// version strings, see update.ts) or Core's fail-open verdict with an
			// `error` field. Both must never read as "you're up to date".
			if (updateCheckFailed(verdict)) {
				sileo.error({
					title: "Couldn't check for updates",
					description: verdict.error ?? "Check your connection and try again.",
				});
			} else if (verdict.update_available) {
				sileo.info({
					title: `Update available — v${verdict.latest}`,
					description: "A new version of Ryu is ready to install.",
				});
			} else {
				sileo.success({ title: "Ryu is up to date" });
			}
		} finally {
			setChecking(false);
		}
	};

	return (
		<div className="space-y-6">
			<UpdatesView
				autoUpdate={autoUpdate}
				checking={checking}
				forceAutoUpdate={FORCE_AUTO_UPDATE}
				onCheck={() => {
					onCheck().catch(() => undefined);
				}}
				onToggle={(next) => {
					onToggle(next).catch(() => undefined);
				}}
				version={version}
			/>
			<ReleaseChannelPicker />
		</div>
	);
}

/** Chooses the release channel (Canary / Nightly / Beta / Stable). The choice
 *  decides which per-channel updater feed the Tauri updater checks, so switching
 *  it changes which builds this install receives. */
const RELEASE_CHANNEL_ITEMS = RELEASE_CHANNELS.map((option) => ({
	value: option.channel,
	label: option.label,
}));

export function ReleaseChannelPicker() {
	const [channel, setChannel] = useReleaseChannel();

	return (
		<SettingsSection
			caption="More bleeding-edge channels update sooner but are less tested."
			title="Release channel"
		>
			<SettingsGroup>
				<SettingsItem
					actions={
						<Select
							items={RELEASE_CHANNEL_ITEMS}
							onValueChange={(v) => setChannel(v as ReleaseChannel)}
							value={channel}
						>
							<SelectTrigger
								className="h-8 w-56 flex-shrink-0 text-sm"
								id="release-channel-select"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{RELEASE_CHANNELS.map((option) => (
									<SelectItem key={option.channel} value={option.channel}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					}
					description="Which builds this install receives. Switching changes which per-channel updater feed Ryu checks."
					title="Channel"
				/>
			</SettingsGroup>
		</SettingsSection>
	);
}
