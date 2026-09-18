import { expect, test } from "bun:test";
import { CallIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { IconArrowUp } from "@tabler/icons-react";
import { renderToStaticMarkup } from "react-dom/server";
import { SendButton } from "./send-button.tsx";

test("uses the same upward-arrow affordance when idle and typing", () => {
	const idleMarkup = renderToStaticMarkup(<SendButton state="idle" />);
	const typingMarkup = renderToStaticMarkup(<SendButton state="typing" />);
	const arrow = renderToStaticMarkup(<IconArrowUp className="size-4" />);

	expect(idleMarkup).toContain(arrow);
	expect(typingMarkup).toContain(arrow);
	expect(idleMarkup).not.toContain("tabler-icon-player-play-filled");
});

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
