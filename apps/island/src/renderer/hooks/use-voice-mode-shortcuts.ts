// Desktop-parity composer shortcuts (Tab / Shift+Tab / Shift+M / Shift+T, or
// whatever the user rebound in Settings → Keyboard shortcuts). Active only while
// island voice mode is open — the typed chat composer wires the same handler
// through MessageInput.

import type { ComposerSettingsSection } from "@ryu/blocks/composer/composer-settings-menu";
import {
	type ComposerShortcutBindings,
	handleComposerSettingsShortcut,
	resolveComposerShortcutBindings,
} from "@ryu/blocks/composer/composer-shortcuts";
import { useEffect, useRef } from "react";

export function useVoiceModeShortcuts(
	active: boolean,
	sections: ComposerSettingsSection[],
	bindings: ComposerShortcutBindings = resolveComposerShortcutBindings()
): void {
	const sectionsRef = useRef(sections);
	sectionsRef.current = sections;
	const bindingsRef = useRef(bindings);
	bindingsRef.current = bindings;

	useEffect(() => {
		if (!active) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent): void => {
			handleComposerSettingsShortcut(
				event,
				sectionsRef.current,
				bindingsRef.current
			);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [active]);
}
