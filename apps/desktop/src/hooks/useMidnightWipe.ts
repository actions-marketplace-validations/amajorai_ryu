// apps/desktop/src/hooks/useMidnightWipe.ts
//
// The Developer-tab switch for the daily "fresh install" wipe on the isolated
// prerelease profiles (canary/nightly). Default OFF.
//
// WHY THIS IS NOT `usePersistedToggle` (the localStorage hook every other
// settings switch uses): the flag has to survive the thing it controls.
//
//   * localStorage is keyed by the bundle identifier, and every channel ships
//     the SAME one (`ai.amajor.ryu.desktop`), so a canary "off" would be shared
//     with the stable install rather than scoped to canary.
//   * Core is the side that acts on it, at boot, before any store opens — it
//     cannot read the webview's storage at all.
//
// So the state lives in one JSON file in the OS config dir, outside the data
// folder being wiped, written through `set_midnight_wipe`
// (`src-tauri/src/midnight_wipe.rs`) and read at boot by Core
// (`apps/core/src/midnight_wipe.rs`). This hook is a thin async mirror of it.
//
// It is deliberately NOT in the settings-sync allowlist (`settings-sync/keys.ts`):
// pushing a destructive local behaviour to another machine — where it would
// apply to a different profile's data folder — is exactly wrong.

import { useCallback, useEffect, useState } from "react";
import { invokeWhenReady } from "@/src/lib/tauri-ready.ts";

/** Mirrors `MidnightWipeStatus` in `src-tauri/src/midnight_wipe.rs`. */
export interface MidnightWipeStatus {
	/** The data folder that would be wiped. */
	data_dir: string;
	enabled: boolean;
	/** `YYYY-MM-DD` of the last wipe, when one has run. */
	last_wipe_date: string | null;
	/** The running build's profile — `canary`, `nightly`, `release`, … */
	profile: string;
	/** Where the flag is stored (outside `data_dir`). */
	state_file: string;
	/** False on stable/dev builds, where the row must not be offered at all. */
	supported: boolean;
}

export interface MidnightWipeControls {
	/** `null` until resolved, and outside Tauri (storyboard, vite preview). */
	error: string | null;
	/** Resolves to whether the write actually applied — the command REFUSES to
	 *  enable on a profile that shares the stable data folder, so a caller must
	 *  never report success from the call having returned. */
	setEnabled: (next: boolean) => Promise<boolean>;
	status: MidnightWipeStatus | null;
}

async function read(): Promise<MidnightWipeStatus | null> {
	try {
		return await invokeWhenReady<MidnightWipeStatus>("get_midnight_wipe");
	} catch {
		return null;
	}
}

export function useMidnightWipe(): MidnightWipeControls {
	const [status, setStatus] = useState<MidnightWipeStatus | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		read().then((next) => {
			if (active) {
				setStatus(next);
			}
		});
		return () => {
			active = false;
		};
	}, []);

	const setEnabled = useCallback(async (next: boolean): Promise<boolean> => {
		setError(null);
		try {
			// The command REFUSES to enable on a profile that shares the stable data
			// folder, so the returned status is the authority — never assume the
			// write took.
			const updated = await invokeWhenReady<MidnightWipeStatus>(
				"set_midnight_wipe",
				{ enabled: next }
			);
			setStatus(updated);
			return updated.enabled === next;
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setStatus(await read());
			return false;
		}
	}, []);

	return { error, setEnabled, status };
}
