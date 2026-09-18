import { expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChat } from "./agent-chat.tsx";

test("renders a host-owned conversation header above the chat stage", () => {
	const markup = renderToStaticMarkup(
		<AgentChat
			conversationHeader={
				<header data-testid="conversation-header">Ryu</header>
			}
			messages={[
				{
					id: "user-1",
					parts: [{ text: "Hello", type: "text" }],
					role: "user",
				} as UIMessage,
			]}
			onSend={() => undefined}
			onStop={() => undefined}
			status="ready"
		/>
	);

	const headerIndex = markup.indexOf('data-testid="conversation-header"');
	const transcriptIndex = markup.indexOf(
		'data-slot="message-scroller-viewport"'
	);

	expect(headerIndex).toBeGreaterThanOrEqual(0);
	expect(transcriptIndex).toBeGreaterThan(headerIndex);
});
