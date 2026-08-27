"use client";

export type {
	RyuAgent,
	RyuCatalogModel,
	RyuCatalogModels,
	RyuCatalogSnapshot,
	RyuPickerMode,
	RyuPickerSelection,
	RyuProvider,
} from "@ryu/ui/components/model-agent-picker.tsx";

// The runtime picker is a composition block, not an app-private control. Keep
// the implementation in @ryu/ui so it can reuse the primitive command/popover
// pieces, and expose the stable block entry point here for Desktop, Island, and
// sandboxed apps to share.
export {
	ModelAgentPicker,
	ModelAgentPicker as RyuRuntimePicker,
	modelOptionsForCatalog,
} from "@ryu/ui/components/model-agent-picker.tsx";
