import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
	isViewVisible,
	subscribeViewVisibility,
} from "@ryu/ui/lib/view-visibility.ts";

if (typeof document === "undefined") {
	GlobalRegistrator.register();
}
test("embedded consumers share one observer and release it after the last unsubscribe", () => {
	const originalParent = Object.getOwnPropertyDescriptor(window, "parent");
	const originalObserver = globalThis.IntersectionObserver;
	let created = 0;
	let disconnected = 0;
	let notify: (entries: IntersectionObserverEntry[]) => void = () => undefined;
	class Observer {
		constructor(callback: IntersectionObserverCallback) {
			created++;
			notify = (entries) =>
				callback(entries, this as unknown as IntersectionObserver);
		}
		observe() {}
		disconnect() {
			disconnected++;
		}
	}
	Object.defineProperty(window, "parent", { configurable: true, value: {} });
	Object.assign(globalThis, { IntersectionObserver: Observer });
	const first: boolean[] = [];
	const second: boolean[] = [];
	const unsubscribe = subscribeViewVisibility(() =>
		first.push(isViewVisible())
	);
	const unsubscribeSecond = subscribeViewVisibility(() =>
		second.push(isViewVisible())
	);
	try {
		expect(created).toBe(1);
		notify([{ isIntersecting: false } as IntersectionObserverEntry]);
		expect(first).toEqual([false]);
		expect(second).toEqual([false]);
		unsubscribe();
		expect(disconnected).toBe(0);
		notify([{ isIntersecting: true } as IntersectionObserverEntry]);
		expect(first).toEqual([false]);
		expect(second).toEqual([false, true]);
		unsubscribeSecond();
		expect(disconnected).toBe(1);
	} finally {
		unsubscribe();
		unsubscribeSecond();
		Object.assign(globalThis, { IntersectionObserver: originalObserver });
		if (originalParent) {
			Object.defineProperty(window, "parent", originalParent);
		} else {
			Reflect.deleteProperty(window, "parent");
		}
	}
});
