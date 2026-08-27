import { describe, expect, test } from "bun:test";
import {
	applyCompanionThemeTokens,
	markCompanionAppRoot,
	subscribeCompanionTheme,
} from "./companion-theme.ts";

describe("companion theme seam", () => {
	function root() {
		const values = new Map<string, string>();
		return {
			values,
			element: {
				style: {
					setProperty: (name: string, value: string) => values.set(name, value),
				},
			},
		} as const;
	}

	test("applies only CSS custom-property tokens", () => {
		const target = root();
		applyCompanionThemeTokens(
			{
				"--primary": "#0099ff",
				foreground: "should-not-apply",
			},
			target.element as unknown as HTMLElement
		);
		expect(target.values.get("--primary")).toBe("#0099ff");
		expect(target.values.get("foreground")).toBeUndefined();
	});

	test("forwards host updates and disposes the subscription", () => {
		let onChange: ((tokens: Record<string, string>) => void) | undefined;
		let disposed = false;
		const target = root();
		const stop = subscribeCompanionTheme(
			{
				shell: {
					subscribeTheme: (options) => {
						onChange = options.onChange;
						return { dispose: () => (disposed = true) };
					},
				},
			},
			target.element as unknown as HTMLElement
		);
		onChange?.({ "--background": "#101010" });
		stop();
		expect(target.values.get("--background")).toBe("#101010");
		expect(disposed).toBe(true);
	});

	test("marks a mounted app root with the fixed UI contract", () => {
		const classes: string[] = [];
		const element = {
			dataset: {} as DOMStringMap,
			classList: { add: (name: string) => classes.push(name) },
		} as unknown as HTMLElement;

		markCompanionAppRoot(element, { surface: "editor" });

		expect(element.dataset.ryuAppUi).toBe("v1");
		expect(element.dataset.ryuSurface).toBe("editor");
		expect(classes).toEqual(["ryu-app-root"]);
	});
});
