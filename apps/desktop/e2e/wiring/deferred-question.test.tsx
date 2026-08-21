import "./setup-dom.ts";

import { afterEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useDeferredQuestion } from "../../../../packages/blocks/src/desktop/agent-elements/use-deferred-question.ts";

(
	globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface PendingQuestion {
	id: string;
}

let markComposerActivity = () => undefined;
let markComposerIdle = () => undefined;
let visibleQuestion: PendingQuestion | null = null;
let currentRoot: Root | null = null;
let currentContainer: HTMLElement | null = null;

const Harness = ({
	question,
	idleMs = 20,
}: {
	question: PendingQuestion | null;
	idleMs?: number;
}) => {
	const deferred = useDeferredQuestion(question, idleMs);
	markComposerActivity = deferred.markComposerActivity;
	markComposerIdle = deferred.markComposerIdle;
	visibleQuestion = deferred.visibleQuestion;
	return null;
};

const renderHarness = async (question: PendingQuestion | null) => {
	if (!(currentRoot && currentContainer)) {
		currentContainer = document.createElement("div");
		document.body.appendChild(currentContainer);
		currentRoot = createRoot(currentContainer);
	}
	await act(async () => {
		currentRoot?.render(<Harness question={question} />);
	});
};

afterEach(async () => {
	if (currentRoot) {
		await act(async () => {
			currentRoot?.unmount();
		});
	}
	currentRoot = null;
	currentContainer?.remove();
	currentContainer = null;
	markComposerActivity = () => undefined;
	markComposerIdle = () => undefined;
	visibleQuestion = null;
});

describe("useDeferredQuestion", () => {
	it("keeps a new question hidden while composer activity is fresh", async () => {
		await renderHarness(null);
		await act(async () => {
			markComposerActivity();
		});
		await renderHarness({ id: "question-1" });

		expect(visibleQuestion).toBeNull();
	});

	it("reveals the pending question after the composer becomes idle", async () => {
		await renderHarness(null);
		await act(async () => {
			markComposerActivity();
		});
		await renderHarness({ id: "question-1" });

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});

		expect(visibleQuestion).toEqual({ id: "question-1" });
	});

	it("shows a question immediately when the composer is already idle", async () => {
		await renderHarness({ id: "question-1" });

		expect(visibleQuestion).toEqual({ id: "question-1" });
	});

	it("reveals the pending question immediately when the draft is cleared", async () => {
		await renderHarness(null);
		await act(async () => {
			markComposerActivity();
		});
		await renderHarness({ id: "question-1" });
		expect(visibleQuestion).toBeNull();

		await act(async () => {
			markComposerIdle();
		});

		expect(visibleQuestion).toEqual({ id: "question-1" });
	});
});
