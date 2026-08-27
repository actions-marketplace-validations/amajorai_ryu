/** The small host seam shared by every sandboxed Companion entrypoint. */
export interface CompanionThemeBridge {
	shell?: {
		subscribeTheme?: (options: {
			onChange: (tokens: Record<string, string>) => void;
		}) => { dispose(): void };
	};
}

export type CompanionAppSurface = "standard" | "editor" | "canvas";

/** Mark a mounted Companion root as using the fixed Ryu App UI contract. */
export function markCompanionAppRoot(
	root: HTMLElement | null,
	options: { surface?: CompanionAppSurface } = {}
): void {
	if (!root) {
		return;
	}
	root.dataset.ryuAppUi = "v1";
	root.dataset.ryuSurface = options.surface ?? "standard";
	root.classList.add("ryu-app-root");
}

/** Apply only valid CSS custom-property tokens from the trusted host. */
export function applyCompanionThemeTokens(
	tokens: Record<string, string>,
	root: HTMLElement | null = typeof document === "undefined"
		? null
		: document.documentElement
): void {
	if (!root) {
		return;
	}
	for (const [name, value] of Object.entries(tokens)) {
		if (name.startsWith("--") && typeof value === "string") {
			root.style.setProperty(name, value);
		}
	}
}

/** Subscribe to the live host theme. Safe to call before a bridge exists. */
export function subscribeCompanionTheme(
	bridge: CompanionThemeBridge | undefined = typeof window === "undefined"
		? undefined
		: (() => {
				const global = globalThis as typeof globalThis & {
					ryu?: CompanionThemeBridge;
					window?: { ryu?: CompanionThemeBridge };
				};
				return global.window?.ryu ?? global.ryu;
			})(),
	root: HTMLElement | null = typeof document === "undefined"
		? null
		: document.documentElement
): () => void {
	const subscribeTheme = bridge?.shell?.subscribeTheme;
	if (!subscribeTheme) {
		return () => undefined;
	}
	const subscription = subscribeTheme({
		onChange: (tokens) => applyCompanionThemeTokens(tokens, root),
	});
	return () => subscription.dispose();
}
