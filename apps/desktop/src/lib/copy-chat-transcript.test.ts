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

	it("includes author name for user messages", () => {
		const text = formatChatTranscript([
			{
				role: "user",
				content: "Hello",
				metadata: { author: { name: "jiawei" } },
			},
			{ role: "assistant", content: "Hi there" },
		]);
		expect(text).toBe("jiawei:\nHello\n\nAssistant:\nHi there");
	});

	it("includes timestamp when createdAt is provided", () => {
		const text = formatChatTranscript([
			{
				role: "user",
				content: "Hello",
				createdAt: new Date("2026-07-27T12:33:00"),
				metadata: { author: { name: "jiawei" } },
			},
		]);
		expect(text).toBe("jiawei, [27/7/2026, 12:33 pm]:\nHello");
	});

	it("falls back to author id when name is not available", () => {
		const text = formatChatTranscript([
			{
				role: "user",
				content: "Hello",
				metadata: { author: { id: "user123" } },
			},
		]);
		expect(text).toBe("user123:\nHello");
	});

	it("uses defaultUserName when no author metadata", () => {
		const text = formatChatTranscript([{ role: "user", content: "Hello" }], {
			defaultUserName: "jiawei",
		});
		expect(text).toBe("jiawei:\nHello");
	});
});
