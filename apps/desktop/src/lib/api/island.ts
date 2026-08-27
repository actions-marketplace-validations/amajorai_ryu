// Island (the Electron companion overlay) install + launch — Tauri command binding.
//
// Island is a device-local Electron process (loopback :7989), not a Core sidecar, so
// Core owns its global-download-backed bundle install while Desktop owns launch and
// visibility. This wraps the `install_and_launch_island` Rust command (see
// src-tauri/src/lib.rs), which waits for the Core-managed platform bundle in
// `~/.ryu/island/` (extracting the `.app` on macOS), then spawns it detached. Island
// self-guards with a single-instance lock, so calling this when it is already running
// just focuses the existing window.
import { invokeWhenReady } from "../tauri-ready.ts";

/**
 * Ensure the Island companion is installed, then launch it. Resolves to the launched
 * bundle path (or `"dev"` in development, where turbo owns Island). Rejects on an
 * unsupported platform or a failed download/launch — callers should treat that as
 * non-fatal (Island is a companion, not required for the app to function).
 */
export const installAndLaunchIsland = (): Promise<string> =>
	invokeWhenReady("install_and_launch_island");

/** Read the running Island window state; null means the companion is unavailable. */
export const getIslandVisibility = (): Promise<boolean | null> =>
	invokeWhenReady("get_island_visibility");

/** Show or hide a running Island companion; null means the command could not reach it. */
export const setIslandVisibility = (
	visible: boolean
): Promise<boolean | null> =>
	invokeWhenReady("set_island_visibility", { visible });
