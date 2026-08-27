// Feedback opens in the user's browser. Remote SDK code must never execute in
// Desktop's privileged Tauri webview, where it could reach session state and
// native commands.
import { openExternal } from "@/lib/tauri-bridge.ts";

const USERJOT_BOARD_URL = "https://ryuhq.userjot.com/";

type Theme = "dark" | "light";

/** Keep the existing call contract while moving the surface out of-process. */
export async function openFeedbackWidget(_theme: Theme): Promise<void> {
	await openExternal(USERJOT_BOARD_URL);
}
