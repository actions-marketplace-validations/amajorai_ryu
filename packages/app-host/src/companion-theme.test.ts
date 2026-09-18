import { describe, expect, test } from "bun:test";
import {
	applyCompanionThemeTokens,
	markCompanionAppRoot,
	readCompanionThemeTokens,
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

	test("projects host appearance state into the Companion document", () => {
		const attributes = new Map<string, string>();
		const classes = new Set<string>();
		const values = new Map<string, string>();
		const target = {
			style: {
				setProperty: (name: string, value: string) => values.set(name, value),
			},
			classList: {
				add: (name: string) => classes.add(name),
				remove: (name: string) => classes.delete(name),
				toggle: (name: string, force?: boolean) => {
					if (force === false) {
						classes.delete(name);
					} else {
						classes.add(name);
					}
				},
			},
			setAttribute: (name: string, value: string) =>
				attributes.set(name, value),
			removeAttribute: (name: string) => attributes.delete(name),
		} as unknown as HTMLElement;

		applyCompanionThemeTokens(
			{
				"--background": "#101114",
				"--ryu-theme-mode": "dark",
				"--ryu-color-scheme": "dark",
				"--ryu-pointer-cursor": "true",
				"--ryu-dialog-overlay-mode": "off",
				"--ryu-popup-overlay-mode": "on",
				"--ryu-animations": "off",
			},
			target
		);

		expect(values.get("--background")).toBe("#101114");
		expect(classes.has("dark")).toBe(true);
		expect(classes.has("light")).toBe(false);
		expect(attributes.get("data-ryu-theme")).toBe("dark");
		expect(attributes.get("data-pointer-cursor")).toBe("true");
		expect(attributes.get("data-dialog-overlay-blur")).toBe("off");
		expect(attributes.get("data-popup-overlay-blur")).toBe("on");
		expect(attributes.get("data-ryu-animations")).toBe("off");
	});

	test("reads the complete token set and desktop first-paint preferences", () => {
		const stored = new Map([
			["ryu_pointer_cursor", "true"],
			["ryu_chrome_shadows", "false"],
			["ryu_dialog_overlay_blur", "true"],
			["ryu_popup_overlay_blur", "true"],
			["ryu_inverted_backgrounds", "true"],
			["ryu:animations-enabled", "false"],
		]);
		const root = {
			classList: { contains: (name: string) => name === "dark" },
			getAttribute: () => null,
			ownerDocument: {
				defaultView: {
					getComputedStyle: () => ({
						getPropertyValue: (name: string) =>
							name === "--primary"
								? "#d946ef"
								: name === "--ryu-timezone"
									? "Asia/Singapore"
									: name === "--ryu-locale"
										? "en-GB"
										: "",
					}),
					localStorage: {
						getItem: (key: string) => stored.get(key) ?? null,
					},
				},
			},
		} as unknown as HTMLElement;

		const tokens = readCompanionThemeTokens(root, {
			includeStoredPreferences: true,
		});

		expect(tokens["--primary"]).toBe("#d946ef");
		expect(tokens["--ryu-timezone"]).toBe("Asia/Singapore");
		expect(tokens["--ryu-locale"]).toBe("en-GB");
		expect(tokens["--card-pad"]).toBe("calc(var(--spacing) * 4)");
		expect(tokens["--ryu-theme-mode"]).toBe("dark");
		expect(tokens["--ryu-color-scheme"]).toBe("dark");
		expect(tokens["--ryu-pointer-cursor"]).toBe("true");
		expect(tokens["--ryu-chrome-shadows"]).toBe("off");
		expect(tokens["--ryu-dialog-overlay-mode"]).toBe("on");
		expect(tokens["--ryu-popup-overlay-mode"]).toBe("on");
		expect(tokens["--ryu-inverted-backgrounds"]).toBe("on");
		expect(tokens["--ryu-animations"]).toBe("off");
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
