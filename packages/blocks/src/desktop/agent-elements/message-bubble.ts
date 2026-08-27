/**
 * The corner rhythm for a stack of consecutive messages from one sender.
 *
 * The outside corners stay round; only the corners that touch the next bubble
 * flatten. Mirroring the contact side for end-aligned bubbles keeps the same
 * shape for the user and assistant sides of the transcript.
 */
export type MessageGroupPosition = "first" | "last" | "middle" | "single";

export function messageBubbleRadius(
	align: "start" | "end",
	position: MessageGroupPosition
): string {
	if (position === "single") {
		return "rounded-2xl";
	}

	if (align === "start") {
		if (position === "first") {
			return "rounded-2xl rounded-bl-md";
		}
		if (position === "last") {
			return "rounded-2xl rounded-tl-md";
		}
		return "rounded-2xl rounded-l-md";
	}

	if (position === "first") {
		return "rounded-2xl rounded-br-md";
	}
	if (position === "last") {
		return "rounded-2xl rounded-tr-md";
	}
	return "rounded-2xl rounded-r-md";
}

export function messageGroupPositionFor(
	index: number,
	count: number
): MessageGroupPosition {
	if (count <= 1) {
		return "single";
	}
	if (index === 0) {
		return "first";
	}
	return index === count - 1 ? "last" : "middle";
}
