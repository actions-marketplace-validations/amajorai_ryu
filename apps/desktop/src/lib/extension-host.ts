import { useSyncExternalStore } from "react";

/** Browser surfaces that can remember a model independently. */
export type BrowserSurface =
	| "dashboard"
	| "new-tab"
	| "ask-ryu"
	| "in-page";

export type BrowserModelStatus =
	| "ready"
	| "not-prepared"
	| "preparing"
	| "failed"
	| "unsupported";

export interface BrowserModelCapabilities {
	actionSupport: boolean;
	chatSupport: boolean;
	visionSupport: boolean;
}

export interface BrowserProviderModel {
	capabilities: BrowserModelCapabilities;
	id: string;
	name: string;
	status: BrowserModelStatus;
	statusMessage?: string;
}

export interface BrowserProviderSnapshot {
	activeAgentId?: string | null;
	activeSurface?: BrowserSurface;
	currentModelBySurface: Partial<Record<BrowserSurface, string>>;
	models: BrowserProviderModel[];
	ready: boolean;
}

export interface BrowserLocalTurnRequest {
	conversationId: string;
	ghostMode?: boolean;
	messages: Array<{ content: string; role: "assistant" | "system" | "user" }>;
	modelId: string;
	requestId: string;
	signal?: AbortSignal;
	surface: BrowserSurface;
}

export interface BrowserLocalTurnResult {
	fallbackRecommended?: boolean;
	pendingApprovals: Array<{ name: string; reason: string }>;
	text: string;
	toolResults: Array<{ message?: string; name: string; ok: boolean }>;
}

export interface BrowserProviderHost {
	getModelSelection: (agentId: string | null, surface: BrowserSurface) => string;
	getSnapshot: () => BrowserProviderSnapshot | null;
	runLocalTurn: (
		request: BrowserLocalTurnRequest
	) => Promise<BrowserLocalTurnResult | null>;
	selectModel: (
		agentId: string | null,
		surface: BrowserSurface,
		modelId: string
	) => void;
	subscribe: (listener: () => void) => () => void;
}

/** Desktop has no browser engine; the extension replaces this at bundle time. */
export const browserProviderHost: BrowserProviderHost = {
	getModelSelection: () => "",
	getSnapshot: () => null,
	selectModel: () => undefined,
	runLocalTurn: async () => null,
	subscribe: () => () => undefined,
};

export function useBrowserProviderSnapshot(): BrowserProviderSnapshot | null {
	return useSyncExternalStore(
		browserProviderHost.subscribe,
		browserProviderHost.getSnapshot,
		() => null
	);
}
