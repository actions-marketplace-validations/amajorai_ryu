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
import {
	canDeferAppUpdate,
	installUpdate,
} from "@/src/components/updater/AutoUpdater.tsx";
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
	type UpdateCheck,
	updateCheckFailed,
} from "@/src/lib/api/update.ts";
import {
	clearPendingAppUpdate,
	describePendingAppUpdate,
	getPendingAppUpdate,
	type PendingAppUpdate,
	scheduleAppUpdate,
} from "@/src/lib/app-update-schedule.ts";
import { verdictAppliesToApp } from "@/src/lib/app-version.ts";
import { appDisplayName } from "@/src/lib/channel-brand.ts";
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
	// The release a check found, held so the "install later" row has something to
	// book. Not derivable from the toast, which is fire-and-forget.
	const [available, setAvailable] = useState<UpdateCheck | null>(null);
	const [pending, setPending] = useState<PendingAppUpdate | null>(null);

	useEffect(() => {
		const target = toTarget(getNode());
		let active = true;
		void (async () => {
			// The app's own version comes from Tauri. Outside a Tauri shell (the
			// browser dev server) that call rejects, so fall back to Core's
			// reported version rather than showing nothing.
			const [appVersion, info, enabled, booked] = await Promise.all([
				getVersion().catch(() => null),
				getVersionInfo(target).catch(() => null),
				getAutoUpdateEnabled(target).catch(() => true),
				getPendingAppUpdate(),
			]);
			if (!active) {
				return;
			}
			setVersion(appVersion ?? info?.ryu_version ?? null);
			setAutoUpdate(enabled);
			setPending(booked);
		})();
		return () => {
			active = false;
		};
	}, [getNode]);

	const onToggle = async (next: boolean) => {
		const previous = autoUpdate;
		setAutoUpdate(next);
		try {
			const ok = await setAutoUpdateEnabled(toTarget(getNode()), next);
			if (ok) {
				return;
			}
			setAutoUpdate(previous);
			sileo.error({ title: "Could not save the auto-update setting" });
		} catch {
			setAutoUpdate(previous);
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
			// Only hold a verdict that can actually be BOOKED. A deferral is
			// replayed at the window without a re-check, so it needs a local node's
			// verdict, a tag to pin to, and a non-rolling channel; without those the
			// install would silently resolve to whatever is newest then. Hiding the
			// offer is the honest failure — the alternative is a button that takes
			// the promise and breaks it eight hours later, unattended.
			setAvailable(
				appIsBehind && canDeferAppUpdate(verdict, node) ? verdict : null
			);
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

	// Book the found release for this machine's next quiet hour.
	//
	// The WHOLE verdict is stored, not just its version: what installs at the
	// window is then the build the user is looking at right now, notes and all.
	// Re-checking then would resolve the static feed to whatever is newest at
	// 03:00 — a different release, on a machine they deliberately chose not to
	// touch during the day.
	const onDefer = async () => {
		if (!available) {
			return;
		}
		try {
			const booked = await scheduleAppUpdate(available);
			setPending(booked);
			sileo.info({ title: describePendingAppUpdate(booked), duration: 8000 });
		} catch (err) {
			// A deferral that could not be written must never be reported as booked
			// — that is the exact failure shape this whole feature exists to avoid.
			sileo.error({
				title: "Couldn't schedule the update",
				description: err instanceof Error ? err.message : String(err),
			});
		}
	};

	const onCancelDefer = async () => {
		await clearPendingAppUpdate();
		setPending(null);
		sileo.info({ title: "Scheduled update cancelled", duration: 4000 });
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
			? `Your lifetime updates ended on ${formatUpdatesCutoff(windowEnd)}. Ryu stays on the newest build they cover. Buy lifetime access again at the current price for another year, or post about Ryu at ryu.com/redeem to earn a free year.`
			: `Updates included through ${formatUpdatesCutoff(windowEnd)}.`;
	}

	return (
		<div className="space-y-6">
			<UpdatesView
				autoUpdate={autoUpdate}
				checking={checking}
				deferredInstallNotice={
					pending ? describePendingAppUpdate(pending) : undefined
				}
				onCancelDeferredInstall={
					pending
						? () => {
								onCancelDefer().catch(() => undefined);
							}
						: undefined
				}
				onCheck={() => {
					onCheck().catch(() => undefined);
				}}
				// Only offered once a check has actually found something to defer.
				// A "book it for tonight" button with no release behind it would be
				// a promise about a version that may not exist.
				onDeferInstall={
					available && !pending
						? () => {
								onDefer().catch(() => undefined);
							}
						: undefined
				}
				onManageUpdates={
					restricted
						? () => useSettingsDialog.getState().openSettings("billing")
						: undefined
				}
				onToggle={(next) => {
					onToggle(next).catch(() => undefined);
				}}
				productName={appDisplayName(version)}
				updatesWindowNotice={updatesWindowNotice}
				version={version}
			/>
			<ReleaseChannelPicker />
		</div>
	);
}
