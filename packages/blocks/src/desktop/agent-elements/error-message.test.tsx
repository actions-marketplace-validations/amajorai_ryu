import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorMessage } from "./error-message.tsx";

test("renders an inline retry action for a recoverable failed turn", () => {
	const markup = renderToStaticMarkup(
		<ErrorMessage
			message="Add credits, then retry."
			onRetry={() => undefined}
			title="OpenRouter credits exhausted"
		/>
	);
	expect(markup).toContain("OpenRouter credits exhausted");
	expect(markup).toContain("Add credits, then retry.");
	expect(markup).toContain(">Retry</span>");
});
