// Live active-app context for the idle island pill (Island U4).
//
// When the user has granted `contextRead`, this hook gently polls Shadow's
// context bridge (via the main-process `window.island.shadow` client) for the
// active app/window and reports a small, render-friendly view:
//
//   - `appName`  the active app (or window title fallback), null when unknown
//   - `live`     true only when Shadow is reachable, capturing, and not paused
//   - `degraded` true when consent is off OR Shadow is unreachable/paused; the
//                pill then shows no live dot and a "context unavailable" tooltip
//
// The poll runs at a deliberately gentle cadence so it never competes with the
// suggestion engine's own context loop. It pauses entirely when `contextRead`
// is not granted (the main-process hard gate would reject the calls anyway).

import { useEffect, useState } from "react";
import { useConsent } from "./use-consent.ts";

/** How often the idle pill refreshes the active-app label (ms). */
const CONTEXT_POLL_MS = 5000;

/** Render-friendly snapshot of the active context for the pill. */
export interface ActiveContext {
	/** Active app name (or window-title fallback), null when unknown. */
	appName: string | null;
	/** True when consent is off or Shadow is down/paused: show no live dot. */
	degraded: boolean;
	/** True only when Shadow is reachable and actively capturing. */
	live: boolean;
}

const DEGRADED: ActiveContext = { appName: null, degraded: true, live: false };

/**
 * Poll the active context while `contextRead` consent is granted. Returns a
 * degraded snapshot (no live dot) whenever consent is off or Shadow is
 * unreachable, so the pill can fall back to the plain idle state gracefully.
 */
export function useActiveContext(): ActiveContext {
	const { consent } = useConsent();
	const contextReadAllowed = consent?.contextRead === true;
	const [context, setContext] = useState<ActiveContext>(DEGRADED);

	useEffect(() => {
		let alive = true;
		let pending = false;

		// Consent off (or not yet answered): never touch Shadow, stay degraded.
		if (!contextReadAllowed) {
			setContext(DEGRADED);
			return () => {
				alive = false;
			};
		}

		const poll = async (): Promise<void> => {
			if (pending || !alive || document.hidden) {
				return;
			}
			pending = true;
			try {
				const result = await window.island.shadow.getCurrentContext();
				if (!alive) {
					return;
				}
				if (!result.available) {
					setContext(DEGRADED);
					return;
				}
				const { app_name, window_title, capture_active, paused } =
					result.context;
				const label = app_name ?? window_title ?? null;
				const capturing = capture_active && !paused;
				setContext((previous) =>
					previous.appName === label &&
					previous.live === capturing &&
					previous.degraded === !capturing
						? previous
						: {
								appName: label,
								live: capturing,
								degraded: !capturing,
							}
				);
			} catch {
				if (alive) {
					setContext(DEGRADED);
				}
			} finally {
				pending = false;
			}
		};

		const automatic = () => void poll();
		automatic();
		const timer = setInterval(automatic, CONTEXT_POLL_MS);
		document.addEventListener("visibilitychange", automatic);

		return () => {
			alive = false;
			clearInterval(timer);
			document.removeEventListener("visibilitychange", automatic);
		};
	}, [contextReadAllowed]);

	return contextReadAllowed ? context : DEGRADED;
}
