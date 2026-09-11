import { expect, test } from "bun:test";
import { CallIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SendButton } from "./send-button.tsx";

test("uses a call affordance for the empty voice-mode composer", () => {
	const markup = renderToStaticMarkup(
		<SendButton state="idle" voiceMode={{ onStart: () => undefined }} />
	);

	expect(markup).toContain('aria-label="Start voice call"');
	expect(markup).toContain('title="Start voice call"');
	expect(markup).toContain(
		renderToStaticMarkup(<HugeiconsIcon className="size-4" icon={CallIcon} />)
	);
	expect(markup).not.toContain("tabler-icon-phone-call");
});
