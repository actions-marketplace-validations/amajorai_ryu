import type { ContributedMessageAction } from "./types.ts";

/** Renderer tag carried by the first-party reactions message action. */
export const MESSAGE_REACTION_RENDERER = "reaction-picker";

/** Local dispatch tag for the first-party reactions action. */
export const MESSAGE_REACTION_DISPATCH = "reactions.toggle";

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
