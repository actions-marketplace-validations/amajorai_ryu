import { describe, expect, test } from "bun:test";
import {
	isMessageReactionAction,
	MESSAGE_REACTION_DISPATCH,
	MESSAGE_REACTION_RENDERER,
} from "./message-action-types.ts";

const reactionAction = {
	args: {
		dispatch: MESSAGE_REACTION_DISPATCH,
		renderer: MESSAGE_REACTION_RENDERER,
	},
	id: "reactions.picker",
	kind: "menu",
	label: "Add reaction",
	plugin: "@ryu/reactions",
	target: "user",
};

describe("isMessageReactionAction", () => {
	test("recognizes the built-in plugin contribution", () => {
		expect(isMessageReactionAction(reactionAction)).toBe(true);
	});

	test("fails closed for unrelated or malformed contributions", () => {
		expect(isMessageReactionAction({ ...reactionAction, kind: "button" })).toBe(
			false
		);
		expect(
			isMessageReactionAction({
				...reactionAction,
				args: { ...reactionAction.args, renderer: "unknown" },
			})
		).toBe(false);
		expect(
			isMessageReactionAction({
				...reactionAction,
				args: { ...reactionAction.args, dispatch: "other.toggle" },
			})
		).toBe(false);
	});
});
