import { describe, expect, test } from "bun:test";
import {
	createMouseNavigationHandler,
	getMouseNavigationAction,
	MOUSE_BACK_BUTTON,
	MOUSE_FORWARD_BUTTON,
} from "./useMouseNavigationButtons.ts";

function mouseEvent(button: number) {
	let defaultPrevented = false;
	return {
		button,
		get defaultPrevented() {
			return defaultPrevented;
		},
		preventDefault() {
			defaultPrevented = true;
		},
	};
}

describe("getMouseNavigationAction", () => {
	test("maps the standard X buttons to back and forward", () => {
		expect(getMouseNavigationAction(MOUSE_BACK_BUTTON)).toBe("back");
		expect(getMouseNavigationAction(MOUSE_FORWARD_BUTTON)).toBe("forward");
	});

	test("ignores primary, middle, and right buttons", () => {
		expect(getMouseNavigationAction(0)).toBeNull();
		expect(getMouseNavigationAction(1)).toBeNull();
		expect(getMouseNavigationAction(2)).toBeNull();
	});
});

describe("createMouseNavigationHandler", () => {
	test("prevents the WebView default and invokes the matching action", () => {
		let backCalls = 0;
		let forwardCalls = 0;
		const handler = createMouseNavigationHandler({
			goBack: () => {
				backCalls += 1;
			},
			goForward: () => {
				forwardCalls += 1;
			},
		});
		const back = mouseEvent(MOUSE_BACK_BUTTON);
		const forward = mouseEvent(MOUSE_FORWARD_BUTTON);

		handler.handle(back);
		handler.handle(forward);

		expect(back.defaultPrevented).toBe(true);
		expect(forward.defaultPrevented).toBe(true);
		expect(backCalls).toBe(1);
		expect(forwardCalls).toBe(1);
		handler.dispose();
	});

	test("deduplicates the multiple DOM events from one physical click", async () => {
		let backCalls = 0;
		const handler = createMouseNavigationHandler({
			goBack: () => {
				backCalls += 1;
			},
			goForward: () => undefined,
		});

		handler.handle(mouseEvent(MOUSE_BACK_BUTTON));
		handler.handle(mouseEvent(MOUSE_BACK_BUTTON));
		handler.handle(mouseEvent(MOUSE_BACK_BUTTON));
		expect(backCalls).toBe(1);

		await new Promise((resolve) => setTimeout(resolve, 0));
		handler.handle(mouseEvent(MOUSE_BACK_BUTTON));
		expect(backCalls).toBe(2);
		handler.dispose();
	});

	test("leaves ordinary mouse buttons untouched", () => {
		let calls = 0;
		const handler = createMouseNavigationHandler({
			goBack: () => {
				calls += 1;
			},
			goForward: () => {
				calls += 1;
			},
		});
		const primary = mouseEvent(0);

		handler.handle(primary);

		expect(primary.defaultPrevented).toBe(false);
		expect(calls).toBe(0);
		handler.dispose();
	});
});
