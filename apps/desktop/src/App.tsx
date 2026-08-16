import { ditherAvatarSeed } from "@ryu/ui/components/dither-kit/avatar.tsx";
import { Logo as OrbLogo } from "@ryu/ui/components/logo.tsx";
import { Toaster, toast } from "@ryu/ui/components/sileo.tsx";
import { DEFAULT_THEME_MODE } from "@ryu/ui/theme/prefs.ts";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/contexts/auth-context.tsx";
import {
	authClient,
	BACKEND_URL,
	clearSessionToken,
	TOKEN_KEY,
	useSession,
	vaultHydrated,
} from "@/lib/auth-client.ts";
import {
	markLocalNudgeShown,
	preferLocalOrCloud,
	shouldNudgeLocalMissing,
} from "@/lib/prefer-local-node.ts";
import { getRyuStatus, startRyuCore } from "@/lib/tauri-bridge.ts";
import { EntitlementProvider } from "@/src/contexts/entitlement-context.tsx";
import { initAnalytics } from "@/src/lib/analytics.ts";
import { fetchWaitlistMe } from "@/src/lib/api/waitlist.ts";
import { initCrashReporting } from "@/src/lib/crash.ts";
import { applyDecorumChrome } from "@/src/lib/decorumTitlebar.ts";
import { startSettingsSync } from "@/src/lib/settings-sync/engine.ts";
// Boot effects fire before Tauri is guaranteed to have injected
// `window.__TAURI_INTERNALS__`, and `listen()` reaches into it for
// `transformCallback` — the single most frequent production error on 0.1.11.
// The gate makes an early subscription wait for the bridge instead of rejecting.
import { listenWhenReady, withTauri } from "@/src/lib/tauri-ready.ts";
import { AgentationToolbar } from "./components/AgentationToolbar.tsx";
import { CrashBoundary } from "./components/CrashBoundary.tsx";
import Layout from "./components/layout/Layout.tsx";
import { PageWrapper } from "./components/layout/PageWrapper.tsx";
import { GlobalContextMenu } from "./components/shell/GlobalContextMenu.tsx";
import { initBackgroundCustomization } from "./hooks/useBackgroundCustomization.ts";
import { initChromeShadows } from "./hooks/useChromeShadows.ts";
import { initInvertedBackgrounds } from "./hooks/useInvertedBackgrounds.ts";
import { initPointerCursor } from "./hooks/usePointerCursor.ts";
import { initTheme, useThemePreset } from "./hooks/useThemePreset.ts";
import { useBuildProfile } from "./lib/build-profile.ts";
import {
	type InstallerProgress,
	installerComponentLabel,
} from "./lib/installer-progress.ts";
import { isOnboardingActive } from "./lib/onboarding-active.ts";
import { useReleaseChannel } from "./lib/release-channel.ts";
import CompanionPage from "./pages/CompanionPage.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import OnboardingPage from "./pages/OnboardingPage.tsx";
import { PreflightPage } from "./pages/PreflightPage.tsx";
import WaitlistPage from "./pages/WaitlistPage.tsx";
import { useAppStore } from "./store/useAppStore.ts";
import {
	isLocalNode,
	LOCAL_FALLBACK,
	useNodeStore,
} from "./store/useNodeStore.ts";

// Detect the Tauri window label synchronously via the internals object that
// Tauri injects before any JS runs. Falls back to "main" in a plain browser.
function getTauriWindowLabel(): string {
	try {
		// biome-ignore lint/suspicious/noExplicitAny: Tauri internal
		const internals = (window as any).__TAURI_INTERNALS__;
		return internals?.metadata?.currentWindow?.label ?? "main";
	} catch {
		return "main";
	}
}

const WINDOW_LABEL = getTauriWindowLabel();

/** Terminates a `listenWhenReady(...).then(...)` chain. Outside Tauri the gate
 *  already resolves to a no-op unlisten, so reaching here means a real subscribe
 *  failure — worth a log, never worth an unhandled rejection at the window. */
function ignoreSubscribeFailure(error: unknown): void {
	console.error("tauri event subscription failed", error);
}

// Remembers the last server-confirmed "approved" so a transient control-plane
// outage doesn't lock an already-approved user out of the app. Cleared on a
// definite "pending" and on sign-out.
const WAITLIST_APPROVED_KEY = "ryu_waitlist_approved";

export default function App() {
	// Companion overlay is a completely separate surface — no auth, no layout.
	// Wrap both surfaces in the crash boundary so an unhandled render error is
	// caught (recoverable fallback, not a white screen) and reported when the user
	// consented to crash reports.
	return (
		<CrashBoundary>
			{WINDOW_LABEL === "companion" ? <CompanionOverlay /> : <MainApp />}
		</CrashBoundary>
	);
}

function CompanionOverlay() {
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme={DEFAULT_THEME_MODE}
			enableSystem
			themes={["light", "dark", "system"]}
		>
			<Toaster position="bottom-right" theme="system" />
			<CompanionPage />
		</ThemeProvider>
	);
}

function ThemeWatcher() {
	useThemePreset();
	return null;
}

/** Syncs the macOS dock / Windows taskbar label with the release channel. */
function WindowTitleManager() {
	const { dev } = useBuildProfile();
	const [channel] = useReleaseChannel();

	useEffect(() => {
		const suffix = dev
			? "Dev"
			: channel === "canary"
				? "Canary"
				: channel === "nightly"
					? "Nightly"
					: channel === "beta"
						? "Beta"
						: null;

		const title = suffix ? `Ryu (Research Preview ${suffix})` : "Ryu";

		// `getCurrentWindow()` reads the bridge's metadata, so this effect fires
		// inside the same cold-start race. Through the gate it retries once the
		// bridge lands and resolves null (rather than throwing) when there is none.
		withTauri(async () => {
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
			await getCurrentWindow().setTitle(title);
		}).catch(() => {
			// Setting the window title is cosmetic — never worth surfacing.
		});
	}, [dev, channel]);

	return null;
}

function MainApp() {
	const setCoreStatus = useAppStore((state) => state.setCoreStatus);
	const coreStatus = useAppStore((state) => state.coreStatus);
	const initNodes = useNodeStore((s) => s.init);
	const { data: session, isPending } = useSession();
	const pendingAuthToken = useAppStore((s) => s.pendingAuthToken);
	const setPendingAuthToken = useAppStore((s) => s.setPendingAuthToken);
	const isAuthenticated = useAppStore((s) => s.isAuthenticated);
	const setIsAuthenticated = useAppStore((s) => s.setIsAuthenticated);
	const setOidcUser = useAppStore((s) => s.setOidcUser);

	// `useSession()` (Better Auth) re-fetches on every window focus, flipping
	// `isPending` back to true. Without this guard that swaps the whole tree to
	// the loading spinner and REMOUNTS LoginPage — so alt-tabbing back from the
	// device-approval tab reset the sign-in flow to "Get Started" and killed the
	// poll. Show the full-screen spinner only until the session resolves the FIRST
	// time; later focus-refetches keep the current screen mounted.
	const [sessionSettledOnce, setSessionSettledOnce] = useState(false);
	useEffect(() => {
		if (!isPending) {
			setSessionSettledOnce(true);
		}
	}, [isPending]);

	useEffect(() => {
		// Initialize product analytics once. Gated: a no-op unless a PostHog key is
		// configured AND the opt-out (seeded synchronously from the localStorage
		// mirror of `product-analytics-enabled`) is on. The Privacy tab seeds the
		// live gate from Core's canonical pref when opened.
		initAnalytics();
		// Initialize the crash reporting tier (SEPARATE consent from analytics).
		// Gated: a no-op unless a Sentry DSN is configured AND the opt-out (seeded
		// from the localStorage mirror of `crash-reports-enabled`) is on. The
		// Privacy tab seeds the live gate from Core's canonical pref when opened.
		initCrashReporting();
		// Settings sync. Starts the local-change observer unconditionally (so
		// per-key timestamps stay accurate for the moment sync is switched on) and
		// only uploads when the user has opted in.
		const stopSettingsSync = startSettingsSync();
		let unlisten: (() => void) | undefined;
		// The gate inside the store makes a too-early `list_nodes` wait for Tauri's
		// bridge, so this no longer rejects on a slow cold start. It can still fail
		// for a real reason (a broken node file), and an uncaught rejection here is
		// what surfaced as "Object.refresh(src/store/useNodeStore)" in production —
		// so the chain terminates in a catch rather than in the window.
		initNodes()
			.then((fn) => {
				unlisten = fn;
			})
			.catch((error: unknown) => {
				console.error("node store init failed", error);
			});
		return () => {
			unlisten?.();
			stopSettingsSync();
		};
	}, [initNodes]);

	useEffect(() => {
		let cancelled = false;

		async function init() {
			// Attempt to spawn Core — ignore errors (may already be running).
			await startRyuCore().catch(() => undefined);

			// Poll the health check for as long as the app is open, rather than
			// giving up at the first verdict. `coreStatus` used to latch: the loop
			// returned on its first "running" or on the timeout, so a Core that came
			// up LATER — which is now the normal case, since onboarding's "run
			// locally" pick is what installs and starts it — left the store stuck on
			// "stopped" and stranded the user on Preflight next render.
			//
			// The grace window only decides when a still-absent Core is reported as
			// "stopped" rather than "starting"; it's long to accommodate first-time
			// Rust compilation in dev.
			const POLL_INTERVAL_MS = 1500;
			const IDLE_POLL_INTERVAL_MS = 5000;
			const GRACE_MS = 180_000;
			const start = Date.now();

			while (!cancelled) {
				const status = await getRyuStatus().catch(() => "stopped");
				if (cancelled) {
					return;
				}
				const settled = Date.now() - start > GRACE_MS;
				if (status === "running") {
					setCoreStatus("running");
				} else if (settled) {
					setCoreStatus("stopped");
				}
				await new Promise((r) =>
					setTimeout(
						r,
						status === "running" || settled
							? IDLE_POLL_INTERVAL_MS
							: POLL_INTERVAL_MS
					)
				);
			}
		}

		init();
		return () => {
			cancelled = true;
		};
	}, [setCoreStatus]);

	useEffect(() => {
		// Surface the same versioned installer stream used inline by onboarding. A
		// no-op in onboarding avoids stacking a toast over the progress card; outside
		// the wizard this keeps background setup visible too.
		const unlisteners: (() => void)[] = [];
		listenWhenReady<InstallerProgress>("installer-progress", ({ payload }) => {
			if (isOnboardingActive()) {
				return;
			}
			const label = installerComponentLabel(payload.component);
			const progress =
				payload.percent === undefined
					? undefined
					: `${payload.percent}% of setup`;
			if (payload.phase === "binary" && payload.status === "started") {
				toast.show({
					title: `Installing ${label}`,
					description: progress,
					type: "loading",
					duration: null,
				});
			} else if (
				payload.phase === "binary" &&
				(payload.status === "complete" || payload.status === "skipped")
			) {
				toast.success(
					payload.status === "skipped"
						? `${label} is already installed`
						: `${label} installed`
				);
			} else if (payload.phase === "core" && payload.status === "started") {
				toast.show({
					title: "Starting Ryu Core",
					description: progress,
					type: "loading",
					duration: null,
				});
			} else if (payload.phase === "defaults") {
				if (
					payload.component === "bundled-defaults" &&
					payload.status === "started"
				) {
					toast.show({
						title: "Setting up Ryu",
						description:
							"Bundled models, engines, and skills are downloading in the background.",
						type: "loading",
						duration: null,
					});
				}
			} else if (
				payload.phase === "bootstrap" &&
				payload.status === "complete"
			) {
				toast.success("Core is ready; bundled defaults continue downloading");
			} else if (payload.phase === "error") {
				toast.error(payload.error ?? "Ryu setup failed");
			}
		})
			.then((fn) => unlisteners.push(fn))
			.catch(ignoreSubscribeFailure);
		return () => {
			for (const fn of unlisteners) {
				fn();
			}
		};
	}, []);

	useEffect(() => {
		// Quick Capture (double-tap Shift). The gesture happens while another app is
		// frontmost, so the toast is the ONLY feedback that it worked — without it
		// the user has no way to tell a capture from a missed tap.
		const unlisteners: (() => void)[] = [];
		listenWhenReady<{ title?: string; source?: { app?: string | null } }>(
			"quick-capture:kept",
			({ payload }) => {
				toast.success({
					title: "Kept",
					description: payload.source?.app
						? `${payload.title ?? "Selection"} · from ${payload.source.app}`
						: (payload.title ?? "Selection"),
				});
			}
		)
			.then((fn) => unlisteners.push(fn))
			.catch(ignoreSubscribeFailure);
		listenWhenReady<{ error?: string }>(
			"quick-capture:failed",
			({ payload }) => {
				toast.error({
					title: "Couldn't keep that",
					description: payload.error ?? "The capture didn't reach Ryu.",
				});
			}
		)
			.then((fn) => unlisteners.push(fn))
			.catch(ignoreSubscribeFailure);
		return () => {
			for (const fn of unlisteners) {
				fn();
			}
		};
	}, []);

	useEffect(() => {
		if (!pendingAuthToken) {
			return;
		}
		setIsAuthenticated(true);
		setPendingAuthToken(null);
		// Force the Better Auth session cache to re-fetch now the bearer token is stored.
		authClient.getSession().catch(() => undefined);
	}, [pendingAuthToken, setPendingAuthToken, setIsAuthenticated]);

	// After the vault hydrates from disk, only treat the user as signed in when
	// the bearer token still resolves to a live session. A stale/expired token
	// used to leave `isAuthenticated` true (token presence only) and trap
	// approved users on the waitlist gate when `/api/waitlist/me` returned 401.
	useEffect(() => {
		let cancelled = false;
		vaultHydrated.then(async () => {
			if (cancelled || pendingAuthToken) {
				return;
			}
			const token = localStorage.getItem(TOKEN_KEY);
			if (!token) {
				return;
			}
			try {
				const res = await fetch(`${BACKEND_URL}/api/auth/get-session`, {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (cancelled) {
					return;
				}
				if (res.ok) {
					const data = (await res.json()) as { user?: { id?: string } };
					if (data.user?.id) {
						setIsAuthenticated(true);
						return;
					}
				}
				await clearSessionToken();
				if (!cancelled) {
					setIsAuthenticated(false);
				}
			} catch {
				// Offline on launch — leave the token; the waitlist gate can use cache.
			}
		});
		return () => {
			cancelled = true;
		};
	}, [pendingAuthToken, setIsAuthenticated]);

	// Webapp returning visits: silently prefer local when reachable, else cloud
	// (nudge once per tab if local is missing). Fresh sign-in nudges from LoginPage.
	useEffect(() => {
		if (import.meta.env.VITE_RYU_SURFACE !== "webapp") {
			return;
		}
		if (!(isAuthenticated || session)) {
			return;
		}
		let cancelled = false;
		preferLocalOrCloud().then((pick) => {
			if (cancelled || pick !== "cloud" || !shouldNudgeLocalMissing()) {
				return;
			}
			markLocalNudgeShown();
			toast.info("No local node detected", {
				description:
					"Using Ryu Cloud for now. Open the node selector to connect a local or remote node.",
			});
		});
		return () => {
			cancelled = true;
		};
	}, [isAuthenticated, session]);

	// Fetch user profile when useSession() returns null but we have a bearer token.
	// Uses get-session (bearer plugin) rather than oauth2/userinfo (expects a JWT).
	useEffect(() => {
		if (!isAuthenticated || session) {
			return;
		}
		const token = localStorage.getItem(TOKEN_KEY);
		if (!token) {
			return;
		}
		fetch(`${BACKEND_URL}/api/auth/get-session`, {
			headers: { Authorization: `Bearer ${token}` },
		})
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				const u = data?.user;
				if (u) {
					setOidcUser({
						name: u.name ?? null,
						email: u.email ?? null,
						picture: u.image ?? null,
					});
				}
			})
			.catch(() => undefined);
	}, [isAuthenticated, session, setOidcUser]);

	// Waitlist activation gate. Once authenticated, ask the control plane whether
	// this account is off the waitlist. Pending accounts see WaitlistPage instead
	// of the app.
	//
	// Fail-CLOSED: the user enters the app ONLY when the server explicitly says
	// "approved". A pending status, an unreachable control plane, or no token all
	// keep the gate up — otherwise the gate is trivially bypassable. To avoid
	// locking out a genuinely-approved user during a transient outage, the last
	// confirmed "approved" is cached; an unresolved check falls back to that cache
	// (but a definite "pending" clears it). The 20s poll lets a fresh approval —
	// or a recovered server — through without a restart.
	const authed = !!session || isAuthenticated;
	const [waitlistGate, setWaitlistGate] = useState<
		"loading" | "approved" | "pending"
	>("loading");

	useEffect(() => {
		if (!authed) {
			setWaitlistGate("loading");
			return;
		}
		let active = true;
		let timer: ReturnType<typeof setInterval> | null = null;
		const stop = () => {
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
		};
		const check = async () => {
			let me: Awaited<ReturnType<typeof fetchWaitlistMe>> = null;
			try {
				me = await fetchWaitlistMe();
			} catch {
				me = null;
			}
			if (!active) {
				return;
			}
			if (me?.status === "approved") {
				localStorage.setItem(WAITLIST_APPROVED_KEY, "1");
				setWaitlistGate("approved");
				stop();
			} else if (me?.status === "pending") {
				localStorage.removeItem(WAITLIST_APPROVED_KEY);
				setWaitlistGate("pending");
			} else if (localStorage.getItem(WAITLIST_APPROVED_KEY) === "1") {
				// Couldn't resolve, but this account was confirmed approved before —
				// don't lock them out over a transient failure.
				setWaitlistGate("approved");
			} else {
				// Unknown: distinguish dead credentials (→ re-login) from a transient
				// outage. Probe with whatever we have — the webapp is often cookie-only
				// (no bearer after the device flow's returnTo redirect), so requiring a
				// stored token here skipped the probe and fell straight through to
				// pending.
				const token = localStorage.getItem(TOKEN_KEY);
				try {
					const res = await fetch(`${BACKEND_URL}/api/auth/get-session`, {
						credentials: "include",
						headers: token ? { Authorization: `Bearer ${token}` } : undefined,
					});
					if (!active) {
						return;
					}
					// get-session answers 200 with a null body when the credentials are
					// dead, so status alone can't tell "signed out" from "signed in" —
					// checking only the status left a stuck account looking healthy.
					const dead =
						res.status === 401 ||
						res.status === 403 ||
						(res.ok &&
							!(
								(await res.json().catch(() => null)) as {
									user?: unknown;
								} | null
							)?.user);
					if (!active) {
						return;
					}
					if (dead) {
						await clearSessionToken();
						setIsAuthenticated(false);
						setWaitlistGate("loading");
						return;
					}
				} catch {
					// Network blip — fall through to fail-closed pending below.
				}
				// Unknown + never confirmed → stay gated (fail closed).
				setWaitlistGate("pending");
			}
		};
		check();
		timer = setInterval(check, 20_000);
		return () => {
			active = false;
			stop();
		};
	}, [authed, setIsAuthenticated]);

	useEffect(() => {
		// `initDialogOverlayBlur()` is deliberately NOT here — it runs in main.tsx
		// module scope, because its default is off while the CSS base state is on,
		// so applying it one effect late would flash a blurred backdrop.
		initTheme();
		initPointerCursor();
		initChromeShadows();
		initInvertedBackgrounds();
		initBackgroundCustomization();
	}, []);

	useEffect(() => {
		// tauri-plugin-decorum re-asserts its native titlebar (full width, with its
		// own drag region) on window events — focus, maximize/restore, resize. The
		// old fix only ran on a 5s interval, so any revert AFTER that window left a
		// full-width decorum bar covering the app's titlebar with the drag region
		// already stripped — making the titlebar undraggable AND the tabs unclickable.
		// Re-assert the fix permanently: an observer (disconnected during our own
		// writes so they don't re-trigger it) plus the same window events decorum
		// reacts to. Also mirrors auto-hide tuck onto the caption buttons.
		const observeOpts: MutationObserverInit = {
			attributes: true,
			attributeFilter: ["style", "class"],
			childList: true,
			subtree: true,
		};
		// Debounced via rAF so a burst of unrelated DOM mutations (e.g. a streaming
		// chat) coalesces into a single fix per frame. Disconnect around our own
		// writes so they never re-trigger the observer into a loop.
		let scheduled = false;
		const run = () => {
			scheduled = false;
			observer.disconnect();
			applyDecorumChrome();
			observer.observe(document.documentElement, observeOpts);
		};
		const observer = new MutationObserver(() => {
			if (scheduled) {
				return;
			}
			scheduled = true;
			requestAnimationFrame(run);
		});
		applyDecorumChrome();
		observer.observe(document.documentElement, observeOpts);
		window.addEventListener("focus", applyDecorumChrome);
		window.addEventListener("resize", applyDecorumChrome);
		return () => {
			observer.disconnect();
			window.removeEventListener("focus", applyDecorumChrome);
			window.removeEventListener("resize", applyDecorumChrome);
		};
	}, []);

	// Preflight ("Ryu Core isn't running") used to gate the ENTIRE tree, ahead of
	// even the login screen — so a machine with no local Core could never reach
	// sign-in, let alone the screen that offers running in the cloud or on an
	// existing node. Core is optional now, so this is scoped to the only users for
	// whom a dead local Core is actually a fault:
	//
	//   * onboarding must already be finished — before that, the choose step is
	//     exactly where a user without Core is supposed to land; and
	//   * the active node must be the local one. A user pointed at their team's
	//     server or a cloud node has no local Core by design, and the node
	//     selector's unreachable banner is the right (non-blocking) signal there.
	const defaultNodeName = useNodeStore((s) => s.defaultNode);
	const nodes = useNodeStore((s) => s.nodes);
	const activeNodeIsLocal = isLocalNode(
		nodes.find((n) => n.name === defaultNodeName) ?? LOCAL_FALLBACK
	);
	const showPreflight =
		coreStatus === "stopped" &&
		activeNodeIsLocal &&
		localStorage.getItem("ryu_onboarding_complete") === "true";

	const showApp = authed;
	// Hold the app behind the waitlist check while it resolves, so we never flash
	// the app and then bounce a pending user to the queue screen.
	const waitlistResolving = showApp && waitlistGate === "loading";
	const waitlisted = showApp && waitlistGate === "pending";

	return (
		<ThemeProvider
			attribute="class"
			defaultTheme={DEFAULT_THEME_MODE}
			enableSystem
			themes={["light", "dark", "system"]}
		>
			<ThemeWatcher />
			<WindowTitleManager />
			<Toaster position="bottom-right" theme="system" />
			<AgentationToolbar />
			<GlobalContextMenu>
				{showPreflight ? (
					<PageWrapper>
						<PreflightPage />
					</PageWrapper>
				) : (isPending && !sessionSettledOnce) || waitlistResolving ? (
					<PageWrapper>
						<div
							className="flex h-full w-full items-center justify-center"
							data-tauri-drag-region
						>
							<OrbLogo size="56px" variant="shimmer" />
						</div>
					</PageWrapper>
				) : waitlisted ? (
					<PageWrapper>
						<WaitlistPage
							avatarSeed={ditherAvatarSeed({
								id: session?.user?.id,
								email: session?.user?.email,
								name: session?.user?.name,
							})}
							avatarUrl={session?.user?.image ?? null}
							userName={session?.user?.name ?? null}
							userNameLoading={isPending}
						/>
					</PageWrapper>
				) : showApp ? (
					<AuthProvider>
						<PageWrapper>
							<EntitlementProvider>
								<MemoryRouter
									initialEntries={[
										localStorage.getItem("ryu_onboarding_complete") === "true"
											? "/chat"
											: "/onboarding",
									]}
								>
									<Routes>
										<Route element={<OnboardingPage />} path="/onboarding" />
										<Route element={<Layout />} path="/*" />
									</Routes>
								</MemoryRouter>
							</EntitlementProvider>
						</PageWrapper>
					</AuthProvider>
				) : (
					<PageWrapper>
						<LoginPage />
					</PageWrapper>
				)}
			</GlobalContextMenu>
		</ThemeProvider>
	);
}
