import { decideUpdateEligibility } from "@ryu/auth/lib/plans";
import { useEffect, useRef } from "react";
import { sileo } from "sileo";
import {
	updateToastBody,
	updateToastId,
} from "@/src/components/updater/ReleaseNotes.tsx";
import { useActiveNodeGetter } from "@/src/hooks/useActiveNode.ts";
import { type ApiTarget, toTarget } from "@/src/lib/api/client.ts";
import {
	applyNodeUpdate,
	checkForUpdate,
	getAutoUpdateEnabled,
	scheduleNodeUpdate,
	type UpdateCheck,
} from "@/src/lib/api/update.ts";
import {
	clearPendingAppUpdate,
	dueAppUpdate,
	getPendingAppUpdate,
} from "@/src/lib/app-update-schedule.ts";
import { getAppVersion, verdictAppliesToApp } from "@/src/lib/app-version.ts";
import {
	getReleaseChannel,
	type ReleaseChannel,
} from "@/src/lib/release-channel.ts";
import {
	formatUpdatesCutoff,
	getUpdatesCutoffMs,
	getUpdatesWindowEnd,
	markNaggedForVersion,
	shouldNagForVersion,
} from "@/src/lib/updates-window.ts";
import { isLocalNode } from "@/src/store/useNodeStore.ts";
import { useSettingsDialog } from "@/src/store/useSettingsDialog.ts";

// Launch-time auto-updater for the desktop. On mount it asks Core whether an
// update is available (Core is the single source of truth for the verdict and
// the shared auto-update toggle). The actual install is performed by
// tauri-plugin-updater — but the toast and the decision to auto-install are
// driven by Core's verdict, so every surface behaves consistently.
//
// - Auto-update ON  → download + install immediately, then relaunch.
// - Auto-update OFF → show a persistent "update available" toast with an action.
// - Lifetime owner past their updates window → Core offers the newest build the
//   window COVERS, and that build is installed pinned to its OWN signed feed
//   (the static feed always resolves to the absolute latest). Once the owner is
//   already at that ceiling they get one prompt per newly-published version,
//   rather than the silent "no update available" a bare clamp would produce.
//
// The Tauri plugins are imported lazily so the verdict/toast layer works even
// when the native updater feed is unavailable (e.g. an unsigned dev build): in
// that case we degrade to a "open downloads" toast rather than throwing.
export function AutoUpdater() {
	const getNode = useActiveNodeGetter();
	const ranRef = useRef(false);

	useEffect(() => {
		// Check exactly once per launch.
		if (ranRef.current) {
			return;
		}
		ranRef.current = true;

		const run = async () => {
			const node = getNode();
			const target = toTarget(node);
			// A deferred install the user already agreed to comes FIRST, before any
			// check. This is the primary execution path for a desktop deferral, not
			// a fallback: the app is normally asleep or quit at 03:00, so "the next
			// launch after the window" is when the promise is actually kept. See
			// `lib/app-update-schedule.ts` for why that is the only promise this
			// surface may make.
			if (await installDeferredUpdate(node)) {
				return;
			}
			// ALWAYS clamped, regardless of which node answers. This verdict has
			// exactly one consumer — `installUpdate`, which drives THIS APP'S OWN
			// bundle — so the window that governs it is this user's, not the queried
			// node's. Keying the clamp on `isLocalNode` instead meant a lapsed owner
			// whose active node was a cloud Core got an unclamped verdict, failed the
			// eligibility guard, and so never reached the pinned branch: the feature
			// would nag them every launch while never delivering the build their
			// window does cover.
			//
			// This does NOT withhold updates from a remote node. Clamping is a query
			// parameter, not a mutation, and the surfaces that update a NODE's own
			// Core/Gateway binaries (the node selector, the Download Center,
			// Preflight) call `checkForUpdate` without it — see
			// `CheckForUpdateOptions.clamp`.
			const verdict = await checkForUpdate(target, { clamp: true });
			if (!verdict.update_available) {
				// Already at the ceiling their window covers, but a newer Ryu exists.
				await notifyUpdatesWindowLapsed(verdict);
				return;
			}
			// Core answered about ITSELF — `verdict.current` is the answering Core
			// binary's version, and Core is a SEPARATE install from this app bundle
			// (on macOS the desktop downloads `ryu-core` into `~/.ryu/bin`). A Core
			// left behind at an older version therefore reported a perfectly true
			// "0.0.14 → 0.1.3" that this app, already on 0.1.3, presented as
			// "Update available — v0.1.3". Everything below drives THIS APP'S bundle,
			// so the app's own version is what the release has to beat.
			if (!(await verdictAppliesToApp(verdict))) {
				return;
			}

			// An install this user already BOOKED for tonight must not be started
			// now, and must not be nagged about again — they made the decision once.
			// Anything still pending here is not yet due, since a due record was
			// installed and cleared above.
			const booked = await getPendingAppUpdate();
			if (booked) {
				if (booked.version === verdict.latest) {
					return;
				}
				// A newer release superseded the booked one. Leaving the stale record
				// would install an older build at the window — which the native
				// updater refuses anyway, so the deferral would silently do nothing
				// forever. Drop it and treat the new release as a fresh decision.
				await clearPendingAppUpdate();
			}

			// The shared cross-surface `auto-updates` preference is the ONLY source of
			// truth for whether we install unattended — the same key the island
			// already honours, so the toggle means the same thing everywhere.
			const auto = await getAutoUpdateEnabled(target);
			if (auto) {
				await installUpdate(verdict, { node });
				return;
			}

			// Notify-only: persistent toast with an explicit install action.
			sileo.info({
				title: `Update available — v${verdict.latest}`,
				description: updateToastBody({
					notes: verdict.notes,
					htmlUrl: verdict.html_url,
					fallback: "A new version of Ryu is ready to install.",
					footnote: verdict.cutoff_waived_for_security
						? "This is a security update, included regardless of your updates window."
						: undefined,
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
		};

		run().catch(() => undefined);
	}, [getNode]);

	// OPPORTUNISTIC, not the mechanism. If the app happens to be open and the
	// machine awake when the window arrives, install then — that is the one case
	// where a desktop deferral can behave like the node's. It is a supplement to
	// the launch check above, never a replacement: a lid-shut laptop runs no
	// timers, and `dueAppUpdate` compares WALL CLOCK precisely so that a machine
	// which slept through the hour still reports the record as due.
	useEffect(() => {
		const timer = setInterval(
			() => {
				installDeferredUpdate(getNode()).catch(() => undefined);
			},
			10 * 60 * 1000
		);
		return () => clearInterval(timer);
	}, [getNode]);

	return null;
}

/**
 * Install a deferred update whose window has passed. Returns whether one was
 * taken over, so the caller can skip its own check.
 *
 * THE RECORD IS CLEARED BEFORE THE INSTALL, NEVER AFTER — installing replaces
 * this bundle and relaunches, so no line after `installUpdate` is guaranteed to
 * run. A record that survived its own install would come due again on the next
 * launch and reinstall forever. Clearing first costs a genuine failure one
 * missed window instead of a restart loop, which is the same trade Core's
 * scheduler makes.
 *
 * `pinned` is what keeps the promise honest: the stored verdict is the one the
 * user was shown, and re-checking now would resolve the static feed to whatever
 * is newest at THIS moment — a different build, with different release notes,
 * on a machine they deliberately chose not to touch during the day.
 */
async function installDeferredUpdate(node: {
	url: string;
}): Promise<boolean> {
	const due = await dueAppUpdate();
	if (!due) {
		return false;
	}
	// The booking may already have been satisfied — by the toast's "Update now",
	// by an auto-install, or by the user installing a build by hand. Nothing else
	// clears the record, so without this the stale one replays forever: the
	// native updater refuses a version that is not newer, we fall back to a
	// "v0.1.5 available" toast shown to someone already on v0.1.5, and the real
	// check for that launch is skipped behind it.
	if (!(await verdictAppliesToApp(due.verdict))) {
		await clearPendingAppUpdate();
		return false;
	}
	// Clearing FIRST, and refusing to install when it fails. Installing replaces
	// this bundle and relaunches, so no line after `installUpdate` is guaranteed
	// to run — a record that survived its own install comes due again next launch
	// and reinstalls forever. If the record cannot be removed at all (a locked or
	// read-only file), the honest move is to leave the normal check to run rather
	// than start a loop nothing can break out of.
	if (!(await clearPendingAppUpdate())) {
		return false;
	}
	await installUpdate(due.verdict, { node, pinned: true });
	return true;
}

/**
 * Whether this release can honestly be booked for the quiet hour.
 *
 * A deferral only means anything if the build that lands later is the one the
 * user agreed to now, and that requires all three:
 *
 *   * a LOCAL node answered. The verdict is replayed hours later without a
 *     re-check, so a remote node's `tag` would let it choose which signed Ryu
 *     build lands on this machine — the exposure `canPinInstall` exists to
 *     deny. The live "Update now" path is not exposed the same way: it resolves
 *     the static feed, which always yields genuine-latest whatever a node says.
 *   * a `tag`. Without one there is nothing to pin to, and the install would
 *     fall through to the static feed and deliver whatever is newest at 03:00.
 *   * a FIXED channel. `nightly` / `canary` are rolling pointers, so pinning to
 *     one installs whatever it holds at the window — the unpinned behaviour
 *     with extra steps.
 *
 * Exported so the surface can hide the offer rather than fail at the window.
 * Not offering a promise you cannot keep is the whole point of this feature.
 */
export function canDeferAppUpdate(
	verdict: UpdateCheck,
	node: { url: string } | undefined
): boolean {
	const channel = getReleaseChannel();
	return (
		node !== undefined &&
		isLocalNode(node) &&
		(verdict.tag ?? "") !== "" &&
		channel !== "nightly" &&
		channel !== "canary"
	);
}

/**
 * Prompt a lifetime owner whose updates window has closed: a newer Ryu exists,
 * they are on the newest build their window covers, and they have two ways to
 * get another year.
 *
 * UNPROMPTED, so it is rationed: no-ops unless the verdict is genuinely clamped,
 * and fires AT MOST ONCE per newly-published version — a persistent purchase
 * prompt on every launch forever is a nag trap. A user-initiated install that
 * has to be refused must NOT route through here; it would be swallowed by this
 * budget the moment the launch check already spent it. See
 * {@link notifyUpdateOutsideWindow}.
 */
export async function notifyUpdatesWindowLapsed(
	verdict: UpdateCheck
): Promise<void> {
	if (!verdict.restricted_by_cutoff) {
		return;
	}
	const newest = verdict.latest_unrestricted ?? verdict.latest;
	if (!(newest && shouldNagForVersion(newest))) {
		return;
	}
	markNaggedForVersion(newest);

	const windowEnd = getUpdatesWindowEnd();
	const ended = windowEnd
		? `Your lifetime updates ended on ${formatUpdatesCutoff(windowEnd)}.`
		: "Your lifetime updates have ended.";
	// Only claim a ceiling Core actually computed. `cutoff_unresolved` means it
	// could not resolve the covered build (`latest` is a placeholder), and an
	// UNCLAMPED verdict never had a ceiling computed at all — there `latest` is
	// the absolute newest release, which is the opposite of what this sentence
	// would be asserting.
	// The build named here is the one the user sees in the About/Updates row — the
	// APP's, from Tauri. `verdict.current` is the answering Core's, and the two are
	// separate installs that routinely differ.
	const current = (await getAppVersion()) ?? verdict.current;
	const ceiling =
		verdict.restricted_by_cutoff && !verdict.cutoff_unresolved
			? ` You're on v${current}, and Ryu stays on the newest build they cover.`
			: "";

	sileo.info({
		title: `Ryu v${newest} is out`,
		// Name the redeem URL rather than just the offer: the button below opens
		// Billing, and Billing has no redeem affordance, so "post about Ryu" with no
		// destination is a promise the app cannot keep.
		description: `${ended}${ceiling} Buy lifetime access again at the current price for another year — or post about Ryu at ryu.com/redeem to earn a free year.`,
		duration: null,
		button: {
			title: "Extend updates",
			onClick: () => {
				useSettingsDialog.getState().openSettings("billing");
			},
		},
	});
}

/**
 * Refuse a user-initiated install that falls outside the owner's updates window.
 *
 * The counterpart to {@link notifyUpdatesWindowLapsed}, and deliberately NOT
 * rationed. That one is an unprompted launch nag with a once-per-version budget;
 * this one answers a button the user just pressed, and the launch check has
 * normally already spent that budget on the same version. Routing this through
 * it made the Download Center, Preflight and node-selector Update actions
 * silently do nothing — the exact dead-button state the guard was added to fix.
 *
 * Answers factually and dismisses itself: an explicit action deserves an
 * explicit answer, not a persistent purchase prompt.
 */
function notifyUpdateOutsideWindow(verdict: UpdateCheck): void {
	const windowEnd = getUpdatesWindowEnd();
	const ended = windowEnd
		? `your lifetime updates ended on ${formatUpdatesCutoff(windowEnd)}`
		: "your lifetime updates have ended";
	sileo.info({
		title: `v${verdict.latest} is outside your updates window`,
		description: `Ryu did not install it because ${ended}. Buy lifetime access again at the current price for another year — or post about Ryu at ryu.com/redeem to earn a free year.`,
		duration: 8000,
		button: {
			title: "Extend updates",
			onClick: () => {
				useSettingsDialog.getState().openSettings("billing");
			},
		},
	});
}

function openDownloads(url: string) {
	window.open(url, "_blank", "noopener");
}

/**
 * The universal fallback: point the user at the release page and let them run
 * the installer by hand. Used whenever we know an update exists but cannot drive
 * it ourselves — no signed feed, a failed native install, or a pin we refused.
 */
function offerManualDownload(verdict: UpdateCheck, downloadsUrl: string): void {
	sileo.info({
		title: `Update v${verdict.latest} available`,
		description: "Open the download page to update manually.",
		duration: null,
		button: {
			title: "Open downloads",
			onClick: () => {
				openDownloads(downloadsUrl);
			},
		},
	});
}

/**
 * Apply the release-train update to the node the user is looking at.
 *
 * The single definition of "which updater is the right one", because it is not
 * always this app's: Core, Gateway and the CLI ship INSIDE the desktop bundle,
 * so for a local node the native updater moves all of them together. For a
 * remote node (a cloud or LAN Core) that same updater would replace the local
 * app and leave the remote binaries untouched — there the node must update
 * itself through `POST /api/update/apply`.
 *
 * Returns a message when it did remote work, `null` when the native updater took
 * over (it owns its own progress toasts and relaunch).
 */
/**
 * Defer a REMOTE node's update to that node's next quiet hour.
 *
 * Only meaningful for a node the desktop does not own. A local node's update
 * ships inside this app bundle and is installed by the native updater, which
 * has its own restart flow — there is nothing on the node to defer.
 *
 * Returns a human sentence naming the time AND the zone. "03:00" alone is the
 * ambiguity deferring exists to remove: the node's zone is usually not the
 * viewer's, and a user in Singapore scheduling a Frankfurt node means
 * Frankfurt's night.
 */
export async function scheduleReleaseUpdate(
	target: ApiTarget,
	node: { url: string },
	verdict: UpdateCheck
): Promise<string> {
	if (isLocalNode(node)) {
		throw new Error(
			"This node updates with the app itself, so there is nothing to schedule."
		);
	}
	if (!verdict.asset) {
		throw new Error(
			`No install asset published for v${verdict.latest} on this node's platform.`
		);
	}
	const pending = await scheduleNodeUpdate(
		target,
		verdict.asset,
		verdict.latest
	);
	const when = new Date(pending.scheduled_for).toLocaleString();
	return `v${pending.version} will install at ${when} (${pending.time_zone}).`;
}

export async function applyReleaseUpdate(
	target: ApiTarget,
	node: { url: string },
	verdict: UpdateCheck
): Promise<string | null> {
	if (!isLocalNode(node)) {
		if (!verdict.asset) {
			throw new Error(
				`No install asset published for v${verdict.latest} on this node's platform.`
			);
		}
		// `POST /api/update/apply` is deliberately ungated: the caller supplies the
		// asset URL, so an entitlement check there would be theatre. Do not "fix"
		// it — see docs/auto-update.md.
		const result = await applyNodeUpdate(target, verdict.asset);
		return result.message;
	}
	await installUpdate(verdict, { node });
	return null;
}

/**
 * Install the release Core clamped us to, pinned to that release's OWN signed
 * feed rather than the static build-time endpoint.
 *
 * A missing per-tag feed is EXPECTED (only signed releases carry one), so the
 * command answering `false` is not an error — it falls back to a manual
 * download, never to the unpinned JS updater.
 */
async function installPinnedUpdate(
	verdict: UpdateCheck,
	tag: string,
	channel: ReleaseChannel,
	downloadsUrl: string
): Promise<void> {
	const progressId = sileo.info({
		title: `Downloading update v${verdict.latest}…`,
		description: "Ryu will restart once the update is installed.",
		duration: null,
	});
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		const { relaunch } = await import("@tauri-apps/plugin-process");
		const installed = await invoke<boolean>("install_update_at_tag", {
			tag,
			channel,
		});
		sileo.dismiss(progressId);
		if (!installed) {
			offerManualDownload(verdict, downloadsUrl);
			return;
		}
		sileo.success({
			title: "Update installed",
			description: "Restarting Ryu…",
			duration: 2000,
		});
		setTimeout(() => {
			relaunch().catch(() => undefined);
		}, 1500);
	} catch {
		sileo.dismiss(progressId);
		offerManualDownload(verdict, downloadsUrl);
	}
}

/**
 * Whether a clamped verdict may be installed by pinning to `verdict.tag`.
 *
 * Every input is a fact the CLIENT owns — never a flag the node asserted.
 * `checkForUpdate` accepts an arbitrary node URL, so a hostile or compromised
 * node could otherwise choose which signed Ryu build lands on this machine, and
 * signature verification does not help when the attacker is picking among
 * legitimately signed releases.
 */
function canPinInstall(
	verdict: UpdateCheck,
	tag: string,
	channel: ReleaseChannel,
	node: { url: string } | undefined
): boolean {
	if (node === undefined || !isLocalNode(node)) {
		return false;
	}
	const cutoffMs = getUpdatesCutoffMs();
	const publishedAtMs = verdict.published_at
		? Date.parse(verdict.published_at)
		: Number.NaN;
	// A security-waived release is published STRICTLY AFTER the cutoff by
	// construction (Core only waives to a marked release newer than the window),
	// so the at-or-before test below is its exact complement: without this
	// allowance the waiver could never install and the whole escape hatch would be
	// inert — a lapsed owner would never receive a security fix.
	//
	// This is the one node-asserted input we accept, and the exposure is bounded:
	// the pin resolves to `releases/download/<tag>/…` on Ryu's own repo, the tag
	// charset is validated in Rust, minisign verification is unchanged, and
	// tauri-plugin-updater refuses any version not strictly newer than the running
	// one. So a hostile node can at most choose among genuinely signed Ryu
	// releases newer than the current build — it cannot downgrade or substitute.
	const withinWindow =
		Number.isFinite(publishedAtMs) &&
		cutoffMs !== null &&
		publishedAtMs <= cutoffMs;
	return (
		cutoffMs !== null &&
		(withinWindow || verdict.cutoff_waived_for_security === true) &&
		tag !== "" &&
		// A rolling pointer (`nightly` / `canary`) does not identify a specific
		// build, so pinning to it is meaningless — it would install whatever the
		// pointer currently holds.
		channel !== "nightly" &&
		channel !== "canary"
	);
}

// Drive the native install through tauri-plugin-updater, surfacing progress via
// sileo. Falls back to a manual-download toast if the native feed is absent.
// Exported so other surfaces (e.g. the node selector's Core/Gateway update
// action) can trigger the same single app-wide install from Core's verdict.
export async function installUpdate(
	verdict: UpdateCheck,
	options?: {
		node?: { url: string };
		/**
		 * Install exactly the release `verdict.tag` names, rather than whatever the
		 * static feed resolves to now.
		 *
		 * Set ONLY by the deferred-install path, where the verdict was pinned when
		 * the user agreed to it and re-resolving would hand over a build they never
		 * saw.
		 *
		 * It does not widen who may install what. The entitlement check below runs
		 * first and unchanged; a clamped verdict still routes through
		 * `canPinInstall`, the updates-window guard, which is left alone; and the
		 * pinned branch carries `canDeferAppUpdate`, which re-imposes the same
		 * `isLocalNode` requirement `canPinInstall` makes — so a remote node still
		 * cannot choose which signed build lands here.
		 */
		pinned?: boolean;
	}
) {
	// Cheap sanity check against a verdict that was not clamped when it should
	// have been — a stale cached response, or a hand-crafted one. It CANNOT cover
	// an older Core: that Core sends no `published_at`, so the verdict is
	// "unknown-release-date" and fails open, exactly as today. The genuine defence
	// against a hostile node is the pinned branch below, which fails closed.
	const releasedAtMs = verdict.published_at
		? Date.parse(verdict.published_at)
		: Number.NaN;
	const eligibility = decideUpdateEligibility({
		cutoffMs: getUpdatesCutoffMs(),
		nowMs: Date.now(),
		releasePublishedAtMs: Number.isFinite(releasedAtMs) ? releasedAtMs : null,
	});
	if (!(eligibility.eligible || verdict.cutoff_waived_for_security)) {
		// Withhold the install, but NEVER in silence. This branch is reached for
		// verdicts Core did not clamp — a remote node answered, or a call site that
		// does not opt into the clamp (the Download Center, Preflight, the node
		// selector) — so it must not borrow the launch nag's once-per-version
		// budget, which is normally already spent on this very version by the time
		// the user presses Update.
		notifyUpdateOutsideWindow(verdict);
		return;
	}

	const downloadsUrl =
		verdict.html_url ?? "https://ryuhq.com/downloads?ref=ryu-app";
	const channel = getReleaseChannel();

	// A restricted verdict means `latest` is NOT the newest published build — it
	// is the newest one the caller's window covers. The JS updater can only read
	// the static feed baked into tauri.conf.json, which always resolves to the
	// ABSOLUTE latest, so installing through it would hand over a build the caller
	// is not entitled to. Pinned installs therefore go through the Rust command
	// against that release's own signed feed.
	//
	// This path fails CLOSED: if any precondition is missing we show the
	// manual-download toast and never fall through to the unclamped JS updater,
	// which would defeat the clamp.
	if (verdict.restricted_by_cutoff) {
		const tag = verdict.tag ?? "";
		if (canPinInstall(verdict, tag, channel, options?.node)) {
			await installPinnedUpdate(verdict, tag, channel, downloadsUrl);
		} else {
			offerManualDownload(verdict, downloadsUrl);
		}
		return;
	}

	// A deferred install on a fixed channel resolves to the tag it was booked
	// against. The JS updater below can only read the static feed baked into
	// tauri.conf.json, which always points at the ABSOLUTE latest — so using it
	// here would install whatever shipped between the user agreeing and the
	// window arriving, which is precisely the thing pinning exists to stop.
	//
	// A rolling pointer (`nightly` / `canary`) is excluded because it does not
	// identify a build: pinning to it would install whatever the pointer holds
	// now, which is the unpinned behaviour with extra steps. Those channels fall
	// through to the channel path below, unchanged.
	if (options?.pinned) {
		// FAILS CLOSED, like the restricted branch above and for a sharper reason.
		// A deferred verdict is replayed hours later with no re-check, so if the
		// preconditions in `canDeferAppUpdate` do not hold we must NOT fall through
		// to the JS updater: that reads the static feed, which always resolves to
		// absolute-latest, and would quietly install a build the user never saw —
		// the exact substitution pinning exists to prevent.
		//
		// The `isLocalNode` half is a trust boundary, not tidiness. `canPinInstall`
		// documents it: a hostile or compromised node choosing among legitimately
		// signed releases is not stopped by signature verification. The surface
		// already refuses to OFFER a deferral in these cases, so reaching here
		// means the record predates that check or the active node changed.
		if (!canDeferAppUpdate(verdict, options.node)) {
			offerManualDownload(verdict, downloadsUrl);
			return;
		}
		await installPinnedUpdate(
			verdict,
			verdict.tag ?? "",
			channel,
			downloadsUrl
		);
		return;
	}

	// Non-stable channels route through the Rust `install_update_from_channel`
	// command, which points the Tauri updater at that channel's own `latest.json`
	// feed (the JS updater below can only read the static Stable endpoint baked
	// into tauri.conf.json). The Stable path is left byte-identical below, so a
	// release user on the default channel behaves exactly as before. If the
	// command is unavailable (older Core-less shell) or fails, we fall through to
	// the manual-download fallback rather than trapping the user.
	if (channel !== "stable") {
		const channelProgressId = sileo.info({
			title: `Downloading ${channel} update v${verdict.latest}…`,
			description: "Ryu will restart once the update is installed.",
			duration: null,
		});
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			const { relaunch } = await import("@tauri-apps/plugin-process");
			const installed = await invoke<boolean>("install_update_from_channel", {
				channel,
			});
			sileo.dismiss(channelProgressId);
			if (installed) {
				sileo.success({
					title: "Update installed",
					description: "Restarting Ryu…",
					duration: 2000,
				});
				setTimeout(() => {
					relaunch().catch(() => undefined);
				}, 1500);
			} else {
				sileo.info({
					title: `No ${channel} update found`,
					description: "You're on the latest build for this channel.",
					duration: 4000,
				});
			}
		} catch {
			sileo.dismiss(channelProgressId);
			offerManualDownload(verdict, downloadsUrl);
		}
		return;
	}

	const progressId = sileo.info({
		title: `Downloading update v${verdict.latest}…`,
		description: "Ryu will restart once the update is installed.",
		duration: null,
	});

	try {
		const { check } = await import("@tauri-apps/plugin-updater");
		const { relaunch } = await import("@tauri-apps/plugin-process");

		const update = await check();
		if (!update) {
			// Core saw a release but the signed Tauri feed isn't reachable yet
			// (typical in dev / before the release CI runs). Offer manual install.
			sileo.dismiss(progressId);
			offerManualDownload(verdict, downloadsUrl);
			return;
		}

		await update.downloadAndInstall();
		sileo.dismiss(progressId);
		sileo.success({
			title: "Update installed",
			description: "Restarting Ryu…",
			duration: 2000,
		});
		setTimeout(() => {
			relaunch().catch(() => undefined);
		}, 1500);
	} catch (err) {
		sileo.dismiss(progressId);
		sileo.error({
			title: "Update failed",
			description: err instanceof Error ? err.message : String(err),
			duration: null,
			button: {
				title: "Retry",
				onClick: () => {
					installUpdate(verdict, options).catch(() => undefined);
				},
			},
		});
	}
}
