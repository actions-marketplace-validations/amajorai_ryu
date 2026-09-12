import { useEffect, useState } from "react";
import {
	isViewVisible,
	subscribeViewVisibility,
} from "../lib/view-visibility.ts";

/** Wall-clock display ticks; active playback may explicitly keep ticking while hidden. */
export function useViewClock(
	intervalMs = 1000,
	runInBackground = false
): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		let timer: ReturnType<typeof setInterval> | undefined;
		const clear = () => {
			if (timer !== undefined) {
				clearInterval(timer);
				timer = undefined;
			}
		};
		const update = () => setNow(Date.now());
		const reconcile = () => {
			clear();
			if (runInBackground || isViewVisible()) {
				update();
				timer = setInterval(update, intervalMs);
			}
		};
		const unsubscribe = subscribeViewVisibility(reconcile);
		reconcile();
		return () => {
			unsubscribe();
			clear();
		};
	}, [intervalMs, runInBackground]);
	return now;
}
