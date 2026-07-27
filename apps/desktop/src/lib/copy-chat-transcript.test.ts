import { describe, expect, it } from "bun:test";
import { formatChatTranscript } from "./copy-chat-transcript.ts";

describe("formatChatTranscript", () => {
	it("joins user and assistant text turns", () => {
		const text = formatChatTranscript([
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi there" },
		]);
		expect(text).toBe("User:\nHello\n\nAssistant:\nHi there");
	});

	it("prefers text parts over content", () => {
		const text = formatChatTranscript([
			{
				role: "assistant",
				content: "fallback",
				parts: [
					{ type: "text", text: "from parts" },
					{ type: "tool-invocation", toolName: "search" },
				],
			},
		]);
		expect(text).toBe("Assistant:\nfrom parts");
	});

	it("skips empty and non-chat roles", () => {
		const text = formatChatTranscript([
			{ role: "system", content: "ignore me" },
			{ role: "user", content: "   " },
			{ role: "assistant", content: "ok" },
		]);
		expect(text).toBe("Assistant:\nok");
	});
});
