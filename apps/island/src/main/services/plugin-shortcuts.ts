import type { PluginContributionsResult } from "../../shared/ipc.ts";
import { parseKeybindingOverrides } from "../../shared/keybindings.ts";
import { pluginContributions } from "./plugin-host.ts";
import { getPreferenceRaw } from "./preferences.ts";

/** Keep current bindings during reads; collapse bursts into a fresh trailing read. */
export function createPluginShortcutRefresh(
	apply: (
		result: PluginContributionsResult,
		overrides: ReturnType<typeof parseKeybindingOverrides>
	) => void
): () => Promise<void> {
	let generation = 0;
	let pending: Promise<void> | null = null;
	const run = async () => {
		for (;;) {
			const current = generation;
			const [result, raw] = await Promise.all([
				pluginContributions(),
				getPreferenceRaw("keybindings"),
			]);
			if (current !== generation) {
				continue;
			}
			apply(result, parseKeybindingOverrides(raw));
			if (current === generation) {
				return;
			}
		}
	};
	return () => {
		generation++;
		pending ??= run().finally(() => {
			pending = null;
		});
		return pending;
	};
}
