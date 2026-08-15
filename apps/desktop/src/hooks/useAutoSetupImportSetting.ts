// apps/desktop/src/hooks/useAutoSetupImportSetting.ts
//
// Opt-in toggle for background import of agent *setup* (the instructions file)
// from the well-known agent config roots, mirroring the thread auto-import
// setting (`useAutoImportThreads`). OFF by default; scanning a folder and
// importing its setup is an explicit user action until this is switched on.

import { usePersistedToggle } from "@/src/hooks/usePersistedToggle.ts";

export const AUTO_SETUP_IMPORT_KEY = "ryu:auto-import-agent-setup";

export function useAutoSetupImportSetting(): [boolean, (v: boolean) => void] {
	return usePersistedToggle(AUTO_SETUP_IMPORT_KEY, false);
}

/** Non-reactive reader for the background poller. */
export function readAutoSetupImportSetting(): boolean {
	try {
		return localStorage.getItem(AUTO_SETUP_IMPORT_KEY) === "true";
	} catch {
		return false;
	}
}
