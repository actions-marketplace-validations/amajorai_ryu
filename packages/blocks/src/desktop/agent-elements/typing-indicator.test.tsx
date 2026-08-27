import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TypingIndicator } from "./typing-indicator.tsx";

test("typing indicator renders only the loading dots", () => {
	const html = renderToStaticMarkup(<TypingIndicator />);

	expect(html).toContain('data-testid="chat-typing-dots"');
	expect(html).not.toContain("Message01Icon");
	expect(html).not.toContain("<svg");
});
