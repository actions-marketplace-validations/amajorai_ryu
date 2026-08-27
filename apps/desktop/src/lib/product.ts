/**
 * Compile-time desktop product identity.
 *
 * Ryu Bot is the managed, account-only distribution of the same desktop
 * runtime. The Vite value changes only the product shell; Core, Gateway, Pi,
 * sandbox, computer access, and organization enforcement remain shared.
 */

export type DesktopProduct = "app" | "build" | "bot";

export function resolveDesktopProduct(value: unknown): DesktopProduct {
	if (value === "app") {
		return "app";
	}
	return value === "bot" ? "bot" : "build";
}

export const DESKTOP_PRODUCT = resolveDesktopProduct(
	import.meta.env.VITE_RYU_PRODUCT
);

export const isRyuBot = (): boolean => DESKTOP_PRODUCT === "bot";

export const isRyuStandaloneApp = (): boolean => DESKTOP_PRODUCT === "app";

export const STANDALONE_APP_ID =
	typeof import.meta.env.VITE_RYU_STANDALONE_APP_ID === "string"
		? import.meta.env.VITE_RYU_STANDALONE_APP_ID.trim()
		: "";

export const STANDALONE_APP_NAME =
	typeof import.meta.env.VITE_RYU_STANDALONE_APP_NAME === "string"
		? import.meta.env.VITE_RYU_STANDALONE_APP_NAME.trim()
		: "";

export const PRODUCT_DISPLAY_NAMES: Record<DesktopProduct, string> = {
	app: "Ryu App",
	bot: "Ryu Bot",
	build: "Ryu",
};

export function desktopProductName(
	product: DesktopProduct = DESKTOP_PRODUCT
): string {
	return PRODUCT_DISPLAY_NAMES[product];
}

/** Bot intentionally keeps the chat surface and its managed agent view only. */
export function isBotRoutePath(path: string): boolean {
	return /^\/chat(?:\/agent\/[^/]+)?$/.test(path);
}
