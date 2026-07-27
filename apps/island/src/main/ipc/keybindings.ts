// IPC bridge for the shared desktop/island `keybindings` preference.
//
// Read-only from the island: desktop owns the settings UI. A one-shot get plus a
// pushed `changed` event keeps composer shortcuts live when the user rebinds.

import { type BrowserWindow, ipcMain } from "electron";
import { IPC } from "../../shared/ipc.ts";
import { KEYBINDINGS_PREF_KEY } from "../../shared/keybindings.ts";
import {
	getPreferenceRaw,
	subscribePreferenceChanges,
} from "../services/preferences.ts";

/** Register the keybindings IPC handlers. Safe to call once. */
export function registerKeybindingsIpc(
	getWindow: () => BrowserWindow | null
): void {
	ipcMain.handle(IPC.keybindings.get, () =>
		getPreferenceRaw(KEYBINDINGS_PREF_KEY)
	);

	subscribePreferenceChanges(KEYBINDINGS_PREF_KEY, (value) => {
		const win = getWindow();
		if (win && !win.isDestroyed()) {
			win.webContents.send(IPC.keybindings.changed, value);
		}
	});
}
