import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AvatarConversationProvider,
	avatarStateFromRunStatus,
	resolveAvatarConversationState,
} from "./avatar-conversation.tsx";
import { parseGhostAvatar } from "./ghost-avatar.ts";
import { GhostAvatarControls } from "./ghost-avatar-controls.tsx";
import { asGlyphValue } from "./glyph.ts";
import { GlyphDisplay } from "./glyph-display.tsx";

const configured = {
	kind: "expressive" as const,
	expression: "random" as const,
	animation: "random" as const,
	variant: "3d" as const,
	bodyStyle: "orb" as const,
	behavior: "conversation" as const,
	colors: { bg: "#ffffff", c1: "#ff6688" },
	animated: true,
	eyeScale: 1.25,
	animationDuration: 12,
};
test("ghost appearance survives persisted glyph normalization", () => {
	expect(asGlyphValue(JSON.parse(JSON.stringify(configured)))).toEqual(
		configured
	);
	expect(parseGhostAvatar({ expression: "happy", animation: "wink" })).toEqual({
		expression: "happy",
		animation: "wink",
	});
});
test("malformed settings are filtered and numeric limits are bounded", () => {
	expect(parseGhostAvatar({ expression: "invalid" })).toBeUndefined();
	expect(
		parseGhostAvatar({
			expression: "neutral",
			variant: "unknown",
			eyeScale: 999,
			animationDuration: -5,
			colors: { c1: "#ff6688", c2: 42, extra: "ignored" },
		})
	).toEqual({
		expression: "neutral",
		variant: undefined,
		eyeScale: 3,
		animationDuration: 1,
		colors: { c1: "#ff6688" },
	});
});
test("conversation avatars use live state and ignore random decorative choices", () => {
	const html = renderToStaticMarkup(
		<AvatarConversationProvider state="error">
			<GlyphDisplay
				animated={false}
				value={{ ...configured, variant: "outline" }}
			/>
		</AvatarConversationProvider>
	);
	expect(html).toContain('data-avatar-state="error"');
	expect(html).toContain('data-expressive-expression="scared"');
	expect(html).toContain('data-expressive-animation="alert"');
	expect(html).toContain("#ff6688");
});
test("manual avatar choices remain independent from conversation state", () => {
	const html = renderToStaticMarkup(
		<AvatarConversationProvider state="error">
			<GlyphDisplay
				animated={false}
				value={{
					kind: "expressive",
					variant: "outline-muted",
					behavior: "custom",
					expression: "happy",
					animation: "wink",
					colors: { c1: "#ff6688" },
				}}
			/>
		</AvatarConversationProvider>
	);
	expect(html).toContain('data-expressive-expression="happy"');
	expect(html).toContain('data-expressive-animation="wink"');
	expect(html).toContain("--muted-foreground:#ff6688");
});
describe("real conversation activity", () => {
	const message = (part: unknown) => [{ role: "assistant", parts: [part] }];
	test("distinguishes reasoning, text, tools, approvals and errors", () => {
		expect(
			resolveAvatarConversationState({ status: "submitted", messages: [] })
		).toBe("thinking");
		expect(
			resolveAvatarConversationState({
				status: "streaming",
				messages: message({ type: "reasoning", text: "hmm" }),
			})
		).toBe("thinking");
		expect(
			resolveAvatarConversationState({
				status: "streaming",
				messages: message({ type: "text", text: "hello" }),
			})
		).toBe("responding");
		expect(
			resolveAvatarConversationState({
				status: "streaming",
				messages: message({ type: "tool-shell", state: "input-available" }),
			})
		).toBe("working");
		expect(
			resolveAvatarConversationState({
				status: "ready",
				messages: message({ type: "tool-shell", state: "approval-requested" }),
			})
		).toBe("waiting");
		expect(
			resolveAvatarConversationState({
				status: "ready",
				messages: [],
				pendingQuestion: true,
			})
		).toBe("waiting");
		expect(
			resolveAvatarConversationState({
				status: "streaming",
				messages: [],
				error: new Error("failed"),
			})
		).toBe("error");
	});
	test("completed history stays idle and latest active part wins", () => {
		expect(
			resolveAvatarConversationState({
				status: "ready",
				messages: message({ type: "tool-shell", state: "output-available" }),
			})
		).toBe("idle");
		expect(
			resolveAvatarConversationState({
				status: "streaming",
				messages: [
					{
						role: "assistant",
						parts: [
							{ type: "tool-shell", state: "output-available" },
							{ type: "text", text: "result" },
						],
					},
				],
			})
		).toBe("responding");
		expect(avatarStateFromRunStatus("running")).toBe("thinking");
		expect(avatarStateFromRunStatus("interrupted")).toBe("waiting");
		expect(avatarStateFromRunStatus("failed")).toBe("error");
		expect(avatarStateFromRunStatus("completed")).toBe("idle");
	});
});

test("legacy outline settings display the same defaults as their rendered avatar", () => {
	const outline = renderToStaticMarkup(
		<GhostAvatarControls
			onChange={() => undefined}
			value={{ variant: "outline" }}
		/>
	);
	expect(outline).toContain('value="currentColor"');
	const muted = renderToStaticMarkup(
		<GhostAvatarControls
			onChange={() => undefined}
			value={{ variant: "outline-muted" }}
		/>
	);
	expect(muted).toContain('value="var(--muted-foreground)"');
	expect(muted).toContain('value="1.5"');
});
