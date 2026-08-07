import { toast } from "@ryu/ui/components/sileo";
import {
	waitlistShareText,
	xShareIntentUrl,
} from "@ryu/ui/components/waitlist-pass";
import { WaitlistQueue } from "@ryu/ui/components/waitlist-queue";
import {
	normalizeWaitlistUsername,
	WAITLIST_USERNAME_RE,
} from "@ryu/ui/components/waitlist-username-field";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import {
	authClient,
	clearSessionToken,
	FRONTEND_URL,
	signOut,
} from "@/lib/auth-client.ts";
import { openExternal } from "@/lib/tauri-bridge.ts";
import { fetchWaitlistMe, type WaitlistMe } from "@/src/lib/api/waitlist.ts";

/** How long the "Copied" label sticks before reverting. */
const COPIED_RESET_MS = 2000;

// The desktop activation gate a pending account sees instead of the app.
//
// The screen itself is `WaitlistQueue` from the UI package — the SAME component
// apps/web renders. This file is only the desktop half of that contract: the
// bearer-token auth client, `openExternal` (the shell has no back button, so
// x.com must never open in the app window), and the reload-based sign-out.
//
// It used to be a second, hand-written copy of the same screen, which is exactly
// why it sat months behind the web one.
export default function WaitlistPage({
	avatarSeed,
	avatarUrl,
	userName,
}: {
	/** Canonical dither seed for the signed-in user (`ditherAvatarSeed`), so the
	 *  pass shows the same placeholder glyph as the sidebar's account row. */
	avatarSeed?: string | null;
	avatarUrl?: string | null;
	userName?: string | null;
}) {
	// The metal ring ships its own light/dark tunings, and its `auto` default
	// follows the OS — wrong here, because the app's theme toggle can disagree
	// with it. Feed it the theme actually on screen.
	const { resolvedTheme } = useTheme();
	const [me, setMe] = useState<WaitlistMe | null>(null);
	const [copied, setCopied] = useState(false);
	const [signingOut, setSigningOut] = useState(false);
	const [handle, setHandle] = useState("");
	const [handleError, setHandleError] = useState<string | null>(null);
	const [reserving, setReserving] = useState(false);
	// Held locally as well as on `me` so the pass flips to the reserved handle the
	// instant the claim succeeds, without waiting for another /me read.
	const [reserved, setReserved] = useState<string | null>(null);

	const loadMe = useCallback(async () => {
		try {
			const data = await fetchWaitlistMe();
			setMe(data);
			// Only adopt the server's handle; never clear a just-reserved one if a
			// background refresh raced ahead of the write.
			const serverHandle = data?.displayUsername ?? data?.username ?? null;
			if (serverHandle) {
				setReserved(serverHandle);
			}
			if (data?.status === "approved") {
				window.location.reload();
			}
		} catch {
			// Background refresh keeps the last known state on screen.
		}
	}, []);

	useEffect(() => {
		loadMe();
	}, [loadMe]);

	// The application form is completed in the browser (Apply for early access
	// opens FRONTEND_URL externally). When the user returns to the desktop window,
	// re-fetch so the Apply button and position reflect their new status instead
	// of the stale pre-apply state.
	useEffect(() => {
		const refresh = () => {
			if (document.visibilityState === "visible") {
				loadMe();
			}
		};
		window.addEventListener("focus", refresh);
		document.addEventListener("visibilitychange", refresh);
		return () => {
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, [loadMe]);

	const copyReferral = async () => {
		if (!me?.referralUrl) {
			return;
		}
		try {
			await navigator.clipboard.writeText(me.referralUrl);
			setCopied(true);
			toast.success("Copied to clipboard");
			setTimeout(() => setCopied(false), COPIED_RESET_MS);
		} catch {
			// Clipboard unavailable; the link is shown for manual copy.
		}
	};

	// Mirror the app's real sign-out (contexts/auth-context.tsx): clear the Better
	// Auth session (so useSession() stops returning the cached session) AND the
	// stored bearer token, then reload so the auth gate re-evaluates to logged-out.
	// Without the signOut()/reload the cached session keeps `authed` true.
	const handleSignOut = async () => {
		if (signingOut) {
			return;
		}
		setSigningOut(true);
		try {
			await Promise.all([signOut(), clearSessionToken()]);
		} finally {
			window.location.reload();
		}
	};

	// Claim the handle now, while queued, so an early position also buys the name.
	const reserveHandle = async () => {
		const next = normalizeWaitlistUsername(handle);
		if (!WAITLIST_USERNAME_RE.test(next)) {
			setHandleError("Use 3–32 letters, numbers or underscores.");
			return;
		}
		setReserving(true);
		setHandleError(null);
		try {
			// Skip the availability check when the handle is already yours.
			// `isUsernameAvailable` answers "is this free", and your own reserved
			// handle is not — so re-confirming it after "Change handle" used to fail
			// with "That handle is already taken", naming you as the taker.
			if (next !== reserved) {
				const availability = await authClient.isUsernameAvailable({
					username: next,
				});
				if (availability.error) {
					throw new Error(availability.error.message ?? "Handle unavailable");
				}
				if (availability.data?.available === false) {
					throw new Error("That handle is already taken.");
				}
			}
			const { error } = await authClient.updateUser({ username: next });
			if (error) {
				throw new Error(error.message ?? "Couldn't reserve that handle.");
			}
			setReserved(next);
			toast.success(`@${next} is reserved`);
		} catch (err) {
			setHandleError(
				err instanceof Error ? err.message : "Couldn't reserve that handle."
			);
		} finally {
			setReserving(false);
		}
	};

	// Open the compose window in the user's browser, never in the app window —
	// the desktop shell has no back button to return from x.com.
	const shareOnX = () => {
		openExternal(
			xShareIntentUrl(
				waitlistShareText(me?.position),
				me?.referralUrl ?? undefined
			)
		);
	};

	return (
		// biome-ignore lint/a11y/noAriaHiddenOnFocusable: top area used as drag region
		<div className="size-full overflow-y-auto" data-tauri-drag-region="true">
			<WaitlistQueue
				avatarSeed={avatarSeed}
				avatarUrl={avatarUrl}
				className="min-h-full"
				copied={copied}
				eta={me?.eta}
				handle={handle}
				handleError={handleError}
				hasApplied={Boolean(me?.hasApplied)}
				joinedAt={me?.joinedAt}
				loaded={Boolean(me)}
				metalTheme={resolvedTheme === "light" ? "light" : "dark"}
				// /waitlist/apply, not /waitlist: the latter is the web queue page,
				// which mirrors this screen — opening it would land the user on a page
				// whose primary CTA is these same words.
				onApply={() => openExternal(`${FRONTEND_URL}/waitlist/apply`)}
				onChangeHandle={(next) => {
					setHandle(next);
					setHandleError(null);
				}}
				onCopyReferral={copyReferral}
				onRefresh={loadMe}
				onReserve={reserveHandle}
				onShare={shareOnX}
				onSignOut={handleSignOut}
				position={me?.position ?? null}
				referralCount={me?.referralCount ?? 0}
				referralUrl={me?.referralUrl}
				reserved={reserved}
				reserving={reserving}
				signingOut={signingOut}
				subtitle="We'll email you the moment your spot opens up."
				totalWaiting={me?.totalWaiting ?? null}
				userName={userName}
			/>
		</div>
	);
}
