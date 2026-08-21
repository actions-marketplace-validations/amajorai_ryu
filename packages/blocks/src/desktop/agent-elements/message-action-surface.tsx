import { isMessageReactionAction } from "./message-action-types.ts";
import { isServerAssignedMessageId } from "./message-reaction-id.ts";
import { MessageReactions } from "./message-reactions.tsx";
import type {
	ContributedMessageAction,
	MessageActionContext,
	MessageActionRuntimeState,
} from "./types.ts";

export {
	isMessageReactionAction,
	MESSAGE_REACTION_DISPATCH,
	MESSAGE_REACTION_RENDERER,
} from "./message-action-types.ts";

export interface MessageActionSurfaceProps {
	actions?: readonly ContributedMessageAction[];
	align?: "start" | "end";
	messageId: string;
	onAction?: (
		action: ContributedMessageAction,
		context: MessageActionContext
	) => void;
	state?: MessageActionRuntimeState;
}

/**
 * Presentational host for message-action plugins.
 *
 * Blocks owns the safe native renderer, while the enabled plugin owns the
 * declaration that opts a surface into it. No contribution means no reaction
 * row, and no callback means no dead controls for read-only surfaces.
 */
export function MessageActionSurface({
	actions,
	align = "end",
	messageId,
	onAction,
	state,
}: MessageActionSurfaceProps) {
	const reactionAction = actions?.find(isMessageReactionAction);
	if (!(reactionAction && onAction)) {
		return null;
	}

	return (
		<MessageReactions
			align={align}
			buckets={state?.reactionBuckets ?? []}
			canReact={isServerAssignedMessageId(messageId)}
			onToggle={(emoji) =>
				onAction(reactionAction, { messageId, value: emoji })
			}
		/>
	);
}
