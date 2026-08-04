// packages/marketplace/src/catalog/use-friendly-mode.ts
//
// Re-export of THE shared "Friendly names" toggle, which lives in `@ryu/ui`
// (`hooks/use-friendly-mode.ts`).
//
// This file used to carry its own copy of the store — same `ryu.catalog.friendly`
// key as the desktop's, but a separate `listeners` Set. Because the `storage`
// event does not fire in the document that wrote it, a toggle flipped from the
// desktop's Appearance tab never reached a catalog section rendered from this
// package in the same window. One key with two stores can only be half-connected;
// the copy is gone and both paths now share one store. Do not re-inline it.

export {
	DEFAULT_FRIENDLY_MODE,
	FRIENDLY_MODE_STORAGE_KEY,
	readFriendlyMode,
	setFriendlyMode,
	subscribeFriendlyMode,
	useFriendlyMode,
} from "@ryu/ui/hooks/use-friendly-mode.ts";
