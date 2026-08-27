import type { ContributedMessageAction } from "./types.ts";

/** Renderer tag carried by the first-party reactions message action. */
export const MESSAGE_REACTION_RENDERER = "reaction-picker";

/** Local dispatch tag for the first-party reactions action. */
export const MESSAGE_REACTION_DISPATCH = "reactions.toggle";

/** Renderer tag carried by the built-in Memory app's citations action. */
export const MEMORY_CITATIONS_RENDERER = "memory-citations";

/**
 * Whether a contribution asks the desktop to render the reaction surface.
 *
 * The manifest still uses the generic `menu` action kind. The renderer-specific
 * payload is opaque to Core, which lets the action travel through the normal
 * contribution feed and lets older shells safely ignore it.
 */
export function isMessageReactionAction(
	action: ContributedMessageAction
): boolean {
	return (
		action.kind === "menu" &&
		action.args?.renderer === MESSAGE_REACTION_RENDERER &&
		action.args?.dispatch === MESSAGE_REACTION_DISPATCH
	);
}

/**
 * Whether a contribution asks the desktop to render the memory-citations
 * tooltip. The payload remains opaque to Core and is interpreted only by the
 * presentational desktop shell.
 */
export function isMemoryCitationsAction(
	action: ContributedMessageAction
): boolean {
	return (
		action.kind === "button" &&
		action.args?.renderer === MEMORY_CITATIONS_RENDERER
	);
}
