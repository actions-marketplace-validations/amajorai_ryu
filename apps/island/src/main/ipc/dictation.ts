// IPC bridge for system-wide dictation. Exposes a one-shot settings read
// (`dictation:get`), pushes live setting changes to the renderer
// (`dictation:changed`), and handles capture submissions (`dictation:submit`):
// the renderer sends the captured WAV, this reads the current settings and runs
// the transcribe → post-process → insert pipeline in `services/dictation.ts`.
//
// The dictation global shortcut itself is registered in the main bootstrap
// (`main/index.ts`), which also owns the `dictation:toggle`/`start`/`stop` sends
// when the shortcut fires.

import { type BrowserWindow, ipcMain } from "electron";
import { DICTATION_PREF_KEY } from "../../shared/dictation.ts";
import { type DictationSubmitResult, IPC } from "../../shared/ipc.ts";
import { SPEECH_PROCESSING_PREF_KEY } from "../../shared/speech-processing.ts";
import { runDictation } from "../services/dictation.ts";
import {
	getPreferenceRaw,
	subscribePreferenceChanges,
} from "../services/preferences.ts";

/**
 * Register the dictation IPC handlers and start the Core SSE subscription.
 * `getWindow` returns the live renderer window so changes always reach the current
 * window even after a macOS re-activation recreates it.
 */
export function registerDictationIpc(
	getWindow: () => BrowserWindow | null
): void {
	ipcMain.handle(IPC.dictation.get, () => getPreferenceRaw(DICTATION_PREF_KEY));

	ipcMain.handle(
		IPC.dictation.submit,
		async (
			_event,
			audio: ArrayBuffer,
			task: "transcribe" | "ask" = "transcribe"
		): Promise<DictationSubmitResult> => {
			const [rawPrefs, rawSpeechProcessing] = await Promise.all([
				getPreferenceRaw(DICTATION_PREF_KEY),
				getPreferenceRaw(SPEECH_PROCESSING_PREF_KEY),
			]);
			return runDictation(audio, rawPrefs, rawSpeechProcessing, task);
		}
	);

	subscribePreferenceChanges(DICTATION_PREF_KEY, (value) => {
		const win = getWindow();
		if (win && !win.isDestroyed()) {
			win.webContents.send(IPC.dictation.changed, value);
		}
	});
}
