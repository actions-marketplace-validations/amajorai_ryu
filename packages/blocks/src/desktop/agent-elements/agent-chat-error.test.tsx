import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChat } from "./agent-chat.tsx";

test("shows one actionable error card for a failed live request", () => {
	const markup = renderToStaticMarkup(
		<AgentChat
			error={new Error("OpenRouter credits exhausted")}
			messages={[]}
			onRetryError={() => undefined}
			onSend={() => undefined}
			onStop={() => undefined}
			status="error"
		/>
	);
	expect(markup.match(/Request failed/g)).toHaveLength(1);
	expect(markup).toContain("OpenRouter credits exhausted");
	expect(markup).toContain(">Retry</span>");
});
