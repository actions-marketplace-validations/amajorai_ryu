import { create } from "zustand";
import { isRyuBot } from "./product.ts";

export type ProductMode = "bot" | "console" | "os";

const STORAGE_KEY = "ryu:product-mode";

function readRequestedMode(): ProductMode {
	try {
		const requested = localStorage.getItem(STORAGE_KEY);
		return requested === "console" || requested === "os" ? requested : "bot";
	} catch {
		return "bot";
	}
}

interface ProductModeState {
	consoleAccess: boolean;
	requestedMode: ProductMode;
	setConsoleAccess: (allowed: boolean) => void;
	setRequestedMode: (mode: ProductMode) => void;
}

/**
 * The product switch is deliberately separate from the old Work/Code
 * preference. Bot/Console chooses the product surface; the surface then sets
 * the existing interface preferences to the safe level for that product.
 *
 * `consoleAccess` starts false so a stale local preference cannot briefly expose
 * Console to a managed-org member while the control-plane role query is still
 * resolving. Local/unbound nodes are explicitly granted access by the access
 * hook because there is no organization boundary to bypass.
 */
export const useProductModeStore = create<ProductModeState>((set) => ({
	consoleAccess: false,
	requestedMode: readRequestedMode(),
	setConsoleAccess: (allowed) => set({ consoleAccess: allowed }),
	setRequestedMode: (mode) => {
		try {
			localStorage.setItem(STORAGE_KEY, mode);
		} catch {
			// Best-effort persistence; the in-memory mode remains authoritative.
		}
		set({ requestedMode: mode });
	},
}));

/** The effective product surface after the server-backed access gate applies. */
export function useProductMode(): ProductMode {
	return useProductModeStore((state) =>
		isRyuBot()
			? "bot"
			: resolveProductMode(state.requestedMode, state.consoleAccess)
	);
}

/** Console is the only mode gated by organization authority; OS is a workspace
 * surface and remains available to the same users who can use Bot. */
export function resolveProductMode(
	requestedMode: ProductMode,
	consoleAccess: boolean
): ProductMode {
	if (requestedMode === "console") {
		return consoleAccess ? "console" : "bot";
	}
	return requestedMode;
}

/** Non-React read for routing and preference helpers. */
export function readProductMode(): ProductMode {
	const state = useProductModeStore.getState();
	return isRyuBot()
		? "bot"
		: resolveProductMode(state.requestedMode, state.consoleAccess);
}

export function isBotMode(): boolean {
	return readProductMode() === "bot";
}

export function setProductMode(mode: ProductMode): void {
	useProductModeStore.getState().setRequestedMode(mode);
}
