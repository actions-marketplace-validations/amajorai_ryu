// apps/desktop/src/hooks/useFeatureFlag.ts
//
// Read one server-driven ROLLOUT flag, and keep it fresh without a restart.
//
// This is the PRIMARY propagation path. `useEntitlement` also publishes the map
// at app entry (a free ride on a fetch that already happens), but that effect
// runs on MOUNT and is not on a timer — so if it were the only publisher, a flip
// made centrally would need an app restart to be seen. This hook closes that gap
// by refreshing on a stale read, which makes "reopen the dialog" enough.
//
// Resolution order, and each step exists for a different failure:
//   1. a fresh cached value          — the normal case
//   2. a stale-but-known value       — served IMMEDIATELY while the refresh runs,
//                                      so a flag never flickers off mid-session
//                                      and an offline client keeps last-good
//   3. `featureFlagFallback(key)`    — the compiled-in default, used only when
//                                      the map has NEVER been read on this
//                                      account
//
// Refresh is bounded by USER ACTION (this hook mounting), never a background
// timer: `/subscription-status` paginates every Polar order for the customer, so
// a fleet-wide 60s poll would hammer Polar and a Polar hiccup would read as
// "flag unknown" everywhere at once. See `src/lib/feature-flags.ts`.
//
// Nothing here may feed the paywall verdict — a rollout flag is not entitlement.

import { featureFlagFallback } from "@ryu/auth/lib/feature-flags";
import { useEffect, useState } from "react";
import {
	isFeatureFlagStale,
	readFeatureFlag,
	refreshFeatureFlags,
} from "@/src/lib/feature-flags.ts";

/** Current best answer for `key`, with the compiled-in default as the floor. */
function resolveNow(key: string): boolean {
	return readFeatureFlag(key) ?? featureFlagFallback(key);
}

/**
 * Whether a capability is switched on for the signed-in account. Always returns
 * a boolean — a caller should never have to reason about "unknown", because the
 * catalog already declared what unknown means for this key.
 */
export function useFeatureFlag(key: string): boolean {
	// Seeded synchronously so the first paint uses the cached value rather than
	// flashing the default and then correcting itself.
	const [enabled, setEnabled] = useState(() => resolveNow(key));

	useEffect(() => {
		let cancelled = false;
		// Re-read on mount even when nothing is stale: another surface (or the
		// app-entry entitlement resolve) may have published since this component
		// last rendered.
		setEnabled(resolveNow(key));
		if (!isFeatureFlagStale()) {
			return;
		}
		refreshFeatureFlags().then(() => {
			if (!cancelled) {
				setEnabled(resolveNow(key));
			}
		});
		return () => {
			cancelled = true;
		};
	}, [key]);

	return enabled;
}
