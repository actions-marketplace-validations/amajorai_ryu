import { invoke } from "@tauri-apps/api/core";

export const startRyuCore = () => invoke<string>("start_ryu_core");
export const stopRyuCore = () => invoke<void>("stop_ryu_core");
export const getRyuStatus = () => invoke<string>("get_ryu_status");
/**
 * Download the `ryu-core` binary into `~/.ryu{profile}/bin` if it is missing,
 * resolving to its path. A no-op (`"dev"`) in dev builds, where turbo owns the
 * binary. Called by the onboarding "run locally" pick, which is the first moment
 * we know the user actually wants a local Core — the app itself no longer
 * requires one to open.
 */
export const ensureCoreInstalled = () =>
	invoke<string>("ensure_core_installed");

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Stop then start the Core process. Waits for health to drop before starting so
 * a node-reset wipe (which runs at the next boot) sees unlocked SQLite files —
 * especially important on Windows where handles linger briefly after exit.
 *
 * Retries start a few times: if wipe is still blocked Core exits immediately
 * (exit 75) without opening stores; another start then retries the wipe.
 */
export const restartRyuCore = async (): Promise<string> => {
	await stopRyuCore().catch(() => undefined);
	for (let i = 0; i < 40; i++) {
		const status = await getRyuStatus().catch(() => "stopped");
		if (status === "stopped") {
			break;
		}
		await sleep(150);
	}
	// Brief settle for OS file-handle release after the process tree dies.
	await sleep(800);

	let last = "";
	for (let attempt = 0; attempt < 5; attempt++) {
		last = await startRyuCore();
		// Give apply_pending_reset time to finish (or exit 75 on failure).
		await sleep(1200);
		const status = await getRyuStatus().catch(() => "stopped");
		if (status === "running") {
			return last;
		}
		await sleep(500);
	}
	return last;
};
export const openExternal = (url: string) =>
	invoke<void>("open_external", { url });

/** Move a tab into a separate OS window (browser-style "open in new window").
 * The new window re-fetches the conversation by id and keeps targeting `node`. */
export const openTabWindow = (opts: {
	path?: string;
	conversationId?: string;
	node?: string;
	title?: string;
}) =>
	invoke<void>("open_tab_window", {
		path: opts.path ?? null,
		conversationId: opts.conversationId ?? null,
		node: opts.node ?? null,
		title: opts.title ?? null,
	});
