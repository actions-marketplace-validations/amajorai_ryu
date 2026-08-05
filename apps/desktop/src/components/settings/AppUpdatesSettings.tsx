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
import {
	updateToastBody,
	updateToastId,
} from "@/src/components/updater/ReleaseNotes.tsx";
import { useActiveNodeGetter } from "@/src/hooks/useActiveNode.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	checkForUpdate,
	getAutoUpdateEnabled,
	getVersionInfo,
	setAutoUpdateEnabled,
	updateCheckFailed,
} from "@/src/lib/api/update.ts";
import { verdictAppliesToApp } from "@/src/lib/app-version.ts";
import {
	formatUpdatesCutoff,
	getUpdatesWindowEnd,
} from "@/src/lib/updates-window.ts";
import { isLocalNode } from "@/src/store/useNodeStore.ts";
import { useSettingsDialog } from "@/src/store/useSettingsDialog.ts";
import { ReleaseChannelPicker } from "./UpdatesSettings.tsx";

export function AppUpdatesSettings() {
	const getNode = useActiveNodeGetter();
	const [version, setVersion] = useState<string | null>(null);
	const [autoUpdate, setAutoUpdate] = useState<boolean>(true);
	const [checking, setChecking] = useState(false);
	const [restricted, setRestricted] = useState(false);

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
			// Resolve the node ONCE: the clamp decision and the install must target
			// the same node even if the active one changes mid-await.
			const node = getNode();
			// Clamp ONLY this app's own local node — a remote/cloud Core has no
			// lifetime owner. See `CheckForUpdateOptions.clamp`.
			const verdict = await checkForUpdate(toTarget(node), {
				clamp: isLocalNode(node),
			});
			// A failed check surfaces as either the fail-soft sentinel (empty
			// version strings, see update.ts) or Core's fail-open verdict with an
			// `error` field. Both must never read as "you're up to date".
			if (updateCheckFailed(verdict)) {
				sileo.error({
					title: "Couldn't check for updates",
					description: verdict.error ?? "Check your connection and try again.",
				});
				return;
			}
			setRestricted(verdict.restricted_by_cutoff === true);
			// This tab is about the APP bundle — that is why the version above comes
			// from Tauri rather than Core's `/api/version`. The verdict has to be
			// held to the same standard: Core reports its OWN version as `current`,
			// and a `~/.ryu/bin/ryu-core` left behind at an older version made this
			// check answer "Update available — v0.1.3" to an app already on 0.1.3.
			const appIsBehind = await verdictAppliesToApp(verdict);
			if (!appIsBehind) {
				// An explicit check asks a factual question and must get a factual
				// answer — not a persistent purchase prompt. Finite duration, both
				// versions named.
				if (verdict.restricted_by_cutoff) {
					sileo.info({
						title: "Ryu is up to date for your updates window",
						description: verdict.cutoff_unresolved
							? `v${verdict.latest_unrestricted ?? verdict.latest} has been released, after your updates window ended.`
							: // `version` (the app's own, from Tauri) not `verdict.current`
								// (the answering Core's) — this sentence names the build the
								// user is looking at in the row right above it.
								`You're on v${version ?? verdict.current}. v${verdict.latest_unrestricted ?? verdict.latest} was released after your updates window ended.`,
						duration: 8000,
						button: {
							title: "Extend updates",
							onClick: () => {
								useSettingsDialog.getState().openSettings("billing");
							},
						},
					});
					return;
				}
				sileo.success({ title: "Ryu is up to date" });
				return;
			}
			// Offer the install rather than starting it unprompted — the same
			// notify-then-install flow the launch-time updater uses when
			// automatic updates are off.
			sileo.info({
				title: `Update available — v${verdict.latest}`,
				description: updateToastBody({
					notes: verdict.notes,
					htmlUrl: verdict.html_url,
					fallback: "A new version of Ryu is ready to install.",
				}),
				id: updateToastId(verdict.latest),
				duration: null,
				button: {
					title: "Update now",
					onClick: () => {
						installUpdate(verdict, { node }).catch(() => undefined);
					},
				},
			});
		} finally {
			setChecking(false);
		}
	};

	// Read straight from storage on every render. The window is written outside
	// React (the entitlement resolve, at launch), so there is nothing to subscribe
	// to: the normal case is that the value is already there on mount, and the
	// `setRestricted` re-render below is what refreshes it after a check. Caching
	// it in state would freeze the row in whatever it read first.
	const windowEnd = getUpdatesWindowEnd();
	// Two different notices, deliberately. A lapsed window with nothing actually
	// withheld is not a reason to sell: the owner is losing nothing until a release
	// they cannot have exists. Only a verdict that came back genuinely clamped
	// earns the buy-again copy and the button.
	let updatesWindowNotice: string | undefined;
	if (windowEnd) {
		updatesWindowNotice = restricted
			? `Your lifetime updates ended on ${formatUpdatesCutoff(windowEnd)}. Ryu stays on the newest build they cover. Buy lifetime access again at the current price for another year — or post about Ryu at ryu.com/redeem to earn a free year.`
			: `Updates included through ${formatUpdatesCutoff(windowEnd)}.`;
	}

	return (
		<div className="space-y-6">
			<UpdatesView
				autoUpdate={autoUpdate}
				checking={checking}
				onCheck={() => {
					onCheck().catch(() => undefined);
				}}
				onManageUpdates={
					restricted
						? () => useSettingsDialog.getState().openSettings("billing")
						: undefined
				}
				onToggle={(next) => {
					onToggle(next).catch(() => undefined);
				}}
				updatesWindowNotice={updatesWindowNotice}
				version={version}
			/>
			<ReleaseChannelPicker />
		</div>
	);
}
