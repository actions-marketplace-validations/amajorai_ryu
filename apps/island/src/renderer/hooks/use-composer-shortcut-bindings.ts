// Resolved composer cycle bindings from the shared Core `keybindings` pref.
// Mirrors the desktop hook so Tab / Shift+Tab / Shift+M / Shift+T (or whatever
// the user rebound in Settings) stay identical on the island typed input and
// voice-mode shortcuts.

import {
	type ComposerShortcutBindings,
	resolveComposerShortcutBindings,
} from "@ryu/blocks/composer/composer-shortcuts";
import { useEffect, useState } from "react";
import { parseKeybindingOverrides } from "../../shared/keybindings.ts";

const DEFAULT_BINDINGS = resolveComposerShortcutBindings();

/** Effective composer shortcut bindings (defaults + user overrides). */
export function useComposerShortcutBindings(): ComposerShortcutBindings {
	const [bindings, setBindings] =
		useState<ComposerShortcutBindings>(DEFAULT_BINDINGS);

	useEffect(() => {
		const apply = (raw: string | null): void => {
			setBindings(
				resolveComposerShortcutBindings(parseKeybindingOverrides(raw))
			);
		};
		window.island.keybindings.get().then(apply);
		return window.island.keybindings.onChanged(apply);
	}, []);

	return bindings;
}
