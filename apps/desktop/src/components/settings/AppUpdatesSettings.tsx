// Updates tab for the *desktop app itself* (the Tauri client), inside the App
// Settings dialog. Its sibling — `UpdatesSettings.tsx` in the Gateway dialog —
// covers the node's Core/Gateway binaries. The two are separate installs that
// can sit at different versions (Core is downloaded and updated independently
// of the shell), so this tab reads the running app's own version from Tauri
// rather than Core's `/api/version`.
//
// It renders the same shared `UpdatesView` block as the Gateway tab, so both
// read identically, and adds an explicit "install now" action: checking here
// can actually apply the update through tauri-plugin-updater.
//
// The automatic-updates switch is deliberately the *same* preference the
// Gateway tab writes (Core's cross-surface preferences KV) — that single toggle
// is what `AutoUpdater.tsx` reads at launch, so a second, app-local one would be
// a dead switch.

import { UpdatesView } from "@ryu/blocks/desktop/updates.tsx";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { sileo } from "sileo";
import { installUpdate } from "@/src/components/updater/AutoUpdater.tsx";
import { useActiveNodeGetter } from "@/src/hooks/useActiveNode.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	checkForUpdate,
	FORCE_AUTO_UPDATE,
	getAutoUpdateEnabled,
	getVersionInfo,
	setAutoUpdateEnabled,
} from "@/src/lib/api/update.ts";
import { ReleaseChannelPicker } from "./UpdatesSettings.tsx";

export function AppUpdatesSettings() {
	const getNode = useActiveNodeGetter();
	const [version, setVersion] = useState<string | null>(null);
	const [autoUpdate, setAutoUpdate] = useState<boolean>(true);
	const [checking, setChecking] = useState(false);

	useEffect(() => {
		const target = toTarget(getNode());
		let active = true;
		void (async () => {
			// The app's own version comes from Tauri. Outside a Tauri shell (the
			// browser dev server) that call rejects, so fall back to Core's
			// reported version rather than showing nothing.
			const [appVersion, info, enabled] = await Promise.all([
				getVersion().catch(() => null),
				getVersionInfo(target).catch(() => null),
				getAutoUpdateEnabled(target),
			]);
			if (!active) {
				return;
			}
			setVersion(appVersion ?? info?.ryu_version ?? null);
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
			// checkForUpdate fails soft to a "no update" verdict with empty
			// version strings (see update.ts). Treat that sentinel as a failed
			// check so we never reassure the user they're up to date when the
			// check never actually completed.
			const checkFailed = !(verdict.update_available || verdict.latest);
			if (checkFailed) {
				sileo.error({
					title: "Couldn't check for updates",
					description: "Check your connection and try again.",
				});
				return;
			}
			if (!verdict.update_available) {
				sileo.success({ title: "Ryu is up to date" });
				return;
			}
			// Offer the install rather than starting it unprompted — the same
			// notify-then-install flow the launch-time updater uses when
			// automatic updates are off.
			sileo.info({
				title: `Update available — v${verdict.latest}`,
				description:
					verdict.notes ?? "A new version of Ryu is ready to install.",
				duration: null,
				button: {
					title: "Update now",
					onClick: () => {
						installUpdate(verdict).catch(() => undefined);
					},
				},
			});
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
