// apps/desktop/src/hooks/useFriendlyMode.ts
//
// Re-export of THE shared "Friendly names" toggle, which now lives in `@ryu/ui`
// (`hooks/use-friendly-mode.ts`) so the desktop, `@ryu/blocks`, `@ryu/marketplace`
// and the plugin host bridge all read one module-level store rather than a copy
// each.
//
// This file stays as the desktop's import path because a dozen surfaces already
// import it, and because the desktop is where the preference is *presented* (the
// Appearance tab). It deliberately holds no logic: the previous duplicate store
// here and the one in `@ryu/marketplace` shared a storage key but not a listener
// set, and since the `storage` event never fires in the writing document, flipping
// the Appearance toggle did not re-render marketplace catalog sections in the same
// window. Re-adding logic here re-opens that split.

export {
	DEFAULT_FRIENDLY_MODE,
	FRIENDLY_MODE_STORAGE_KEY,
	readFriendlyMode,
	setFriendlyMode,
	subscribeFriendlyMode,
	useFriendlyMode,
} from "@ryu/ui/hooks/use-friendly-mode.ts";
