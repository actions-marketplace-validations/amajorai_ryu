import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button";
import { Logo as OrbLogo } from "@ryu/ui/components/logo";
import { toast } from "@ryu/ui/components/sileo";
import { Spinner } from "@ryu/ui/components/spinner";
import { StaggerReveal } from "@ryu/ui/components/stagger-reveal";
import {
	WaitlistPass,
	waitlistShareText,
	xShareIntentUrl,
} from "@ryu/ui/components/waitlist-pass";
import {
	normalizeWaitlistUsername,
	WAITLIST_USERNAME_RE,
	WaitlistUsernameField,
} from "@ryu/ui/components/waitlist-username-field";
import { cn } from "@ryu/ui/lib/utils";
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

/** How long Refresh stays disabled after a press. */
const REFRESH_COOLDOWN_MS = 60_000;
/**
 * Persisted so the cooldown survives a reload. On the webapp build this page is
 * an ordinary route, so refreshing the browser would otherwise reset the limit
 * and make it decorative — the one place a cooldown has to hold is exactly where
 * reloading is free.
 */
const REFRESH_COOLDOWN_KEY = "ryu_waitlist_refresh_until";

function readCooldownUntil(): number {
	try {
		const raw = Number(localStorage.getItem(REFRESH_COOLDOWN_KEY) ?? "0");
		// Must be a FUTURE stamp within one cooldown. A clock that moved backwards,
		// or a hand-edited value, must not lock the button for hours.
		const ahead = raw - Date.now();
		return Number.isFinite(raw) && ahead > 0 && ahead <= REFRESH_COOLDOWN_MS
			? raw
			: 0;
	} catch {
		return 0;
	}
}

// The desktop activation gate a pending account sees instead of the app. Mirrors
// the device-auth login screen (packages/blocks/src/desktop/login.tsx): the same
// centered column, the shimmering orb, title + subtitle, a full-width mono
// action in max-w-xs, the muted panel for position, and a small underline action.
export default function WaitlistPage({
	avatarUrl,
	userName,
}: {
	avatarUrl?: string | null;
	userName?: string | null;
}) {
	// The metal ring ships its own light/dark tunings, and its `auto` default
	// follows the OS — wrong here, because the app's theme toggle can disagree
	// with it. Feed it the theme actually on screen.
	const { resolvedTheme } = useTheme();
	const [me, setMe] = useState<WaitlistMe | null>(null);
	const [copied, setCopied] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [cooldownUntil, setCooldownUntil] = useState<number>(readCooldownUntil);
	const [now, setNow] = useState(() => Date.now());
	const cooldownLeftMs = Math.max(0, cooldownUntil - now);
	const cooldownSeconds = Math.ceil(cooldownLeftMs / 1000);
	const [signingOut, setSigningOut] = useState(false);
	const [handle, setHandle] = useState("");
	const [handleError, setHandleError] = useState<string | null>(null);
	const [reserving, setReserving] = useState(false);
	// Held locally as well as on `me` so the pass flips to the reserved handle the
	// instant the claim succeeds, without waiting for another /me read.
	const [reserved, setReserved] = useState<string | null>(null);

	const loadMe = useCallback(async (opts?: { manual?: boolean }) => {
		if (opts?.manual) {
			setRefreshing(true);
			// Armed on press, not on success: the point is to rate-limit the request,
			// and a failed read costs the server exactly what a successful one does.
			const until = Date.now() + REFRESH_COOLDOWN_MS;
			setCooldownUntil(until);
			setNow(Date.now());
			try {
				localStorage.setItem(REFRESH_COOLDOWN_KEY, String(until));
			} catch {
				// Storage unavailable: the in-memory cooldown still holds for this view.
			}
		}
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
		} catch (err) {
			if (opts?.manual) {
				const network = err instanceof Error && err.message === "network";
				toast.error("Couldn't refresh", {
					description: network
						? "Can't reach the server. Check your connection, then try again."
						: "Try again in a moment.",
				});
			}
			// Background refresh keeps the last known state on screen.
		} finally {
			if (opts?.manual) {
				setRefreshing(false);
			}
		}
	}, []);

	useEffect(() => {
		loadMe();
	}, [loadMe]);

	// Tick only while the cooldown runs, so an idle page is not re-rendering once
	// a second forever.
	useEffect(() => {
		if (cooldownLeftMs <= 0) {
			return;
		}
		const id = setInterval(() => setNow(Date.now()), 500);
		return () => clearInterval(id);
	}, [cooldownLeftMs]);

	// The application form is completed in the browser (Apply for early access
	// opens FRONTEND_URL/waitlist externally). When the user returns to the
	// desktop window, re-fetch so the Apply button and position reflect their
	// new status instead of the stale pre-apply state.
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
			setTimeout(() => setCopied(false), 2000);
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
	// Availability is checked first purely for the error copy: `updateUser` is the
	// only thing that actually enforces uniqueness.
	const reserveHandle = async () => {
		const next = normalizeWaitlistUsername(handle);
		if (!WAITLIST_USERNAME_RE.test(next)) {
			setHandleError("Use 3–32 letters, numbers or underscores.");
			return;
		}
		setReserving(true);
		setHandleError(null);
		try {
			const availability = await authClient.isUsernameAvailable({
				username: next,
			});
			if (availability.error) {
				throw new Error(availability.error.message ?? "Handle unavailable");
			}
			if (availability.data?.available === false) {
				throw new Error("That handle is already taken.");
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

	const title = userName
		? `You're in line, ${userName}`
		: "You're on the waitlist";

	return (
		// biome-ignore lint/a11y/noAriaHiddenOnFocusable: top area used as drag region
		<div className="size-full" data-tauri-drag-region="true">
			<div
				className="flex h-full w-full items-center justify-center overflow-y-auto p-8"
				data-tauri-drag-region="true"
			>
				{/* Two columns: the membership pass on the left, the queue facts and
				    the actions that change them on the right. Collapses to one column
				    in a narrow window, pass first — it is the reason to keep the
				    screen open. The pass sits outside StaggerReveal because that
				    clones a transition onto each child, and layering a 500ms blur-rise
				    over the card's own 3D transform fights it on mount. */}
				<div className="grid w-full max-w-3xl items-center gap-8 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:gap-12">
					<div className="mx-auto w-full max-w-[17rem] lg:mx-0">
						<WaitlistPass
							avatarUrl={avatarUrl}
							joinedAt={me?.joinedAt}
							metalTheme={resolvedTheme === "light" ? "light" : "dark"}
							name={userName}
							position={me?.position ?? null}
							referralCount={me?.referralCount ?? 0}
							serialSeed={me?.referralCode}
							totalWaiting={me?.totalWaiting ?? null}
							username={reserved}
						/>
					</div>

					<div className="flex w-full flex-col items-start gap-6">
						<StaggerReveal>
							<div className="shrink-0">
								<OrbLogo size="50px" variant="outline" />
							</div>

							<div className="space-y-1 text-left">
								<h1 className="font-medium text-xl">{title}</h1>
								<p className="font-medium text-muted-foreground text-xl">
									We&apos;re sending out invites soon.
								</p>
								<p className="font-medium text-muted-foreground text-xl">
									We&apos;ll email you the moment your spot opens up.
								</p>
							</div>

							{me ? (
								// The numbers the pass doesn't carry. The estimate is a softer
								// kind of fact than the position, so it is labelled as one.
								<div className="grid w-full max-w-xs grid-cols-2 gap-2">
									<div className="rounded-xl bg-muted/40 px-4 py-3">
										<p className="text-muted-foreground text-xs">In line</p>
										<p className="font-semibold text-base tabular-nums">
											{me.totalWaiting.toLocaleString()}
										</p>
									</div>
									<div className="rounded-xl bg-muted/40 px-4 py-3">
										<p className="text-muted-foreground text-xs">Est. wait</p>
										<p className="font-semibold text-base">{me.eta ?? "—"}</p>
									</div>
								</div>
							) : null}

							{me ? (
								<WaitlistUsernameField
									className="w-full max-w-xs"
									error={handleError}
									onChange={(next) => {
										setHandle(next);
										setHandleError(null);
									}}
									onSubmit={reserveHandle}
									pending={reserving}
									reserved={reserved}
									value={handle}
								/>
							) : null}

							<div className="flex w-full max-w-xs flex-col items-center gap-3">
								{/* Apply leads and is the default variant: it is the one action
								    that changes the outcome. Refresh only re-reads state, so it
								    sits under it as secondary. */}
								{me && !me.hasApplied ? (
									<Button
										className="w-full"
										// /waitlist/apply, not /waitlist: the latter is the web queue
										// page, which mirrors this screen — opening it would land
										// the user on a page whose primary CTA is these same words.
										onClick={() =>
											openExternal(`${FRONTEND_URL}/waitlist/apply`)
										}
										size="lg"
										type="button"
									>
										Apply for early access
									</Button>
								) : null}

								<Button
									className="w-full"
									disabled={refreshing || cooldownLeftMs > 0}
									onClick={() => loadMe({ manual: true })}
									size="lg"
									type="button"
									variant="secondary"
								>
									{refreshing ? (
										<span className="flex items-center gap-2">
											<Spinner className="size-4" />
											Refreshing…
										</span>
									) : (
										`Refresh${cooldownLeftMs > 0 ? ` ${cooldownSeconds}s` : ""}`
									)}
								</Button>
							</div>

							{me?.referralUrl ? (
								<div className="flex w-full max-w-xs flex-col items-center gap-3">
									<p className="text-muted-foreground text-xs">
										Want in faster? Share your link, and every friend who joins
										moves you up.
										{me.referralCount > 0
											? ` You've referred ${me.referralCount}.`
											: ""}
									</p>
									<button
										aria-label="Copy referral link"
										className="group flex w-full items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60"
										onClick={copyReferral}
										type="button"
									>
										<span className="min-w-0 flex-1 truncate text-muted-foreground group-hover:text-foreground">
											{me.referralUrl}
										</span>
										<span
											aria-hidden={!copied}
											className={cn(
												"flex shrink-0 items-center gap-1 font-medium text-primary transition-all duration-300 ease-out",
												copied
													? "translate-x-0 opacity-100"
													: "pointer-events-none translate-x-2 opacity-0"
											)}
										>
											<HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} />
											Copied
										</span>
									</button>
									<Button
										className="w-full"
										onClick={shareOnX}
										type="button"
										variant="secondary"
									>
										Share on X
									</Button>
								</div>
							) : null}

							<button
								className="text-xs underline underline-offset-2 disabled:opacity-50"
								disabled={signingOut}
								onClick={handleSignOut}
								type="button"
							>
								{signingOut ? "Signing out…" : "Sign out"}
							</button>
						</StaggerReveal>
					</div>
				</div>
			</div>
		</div>
	);
}
