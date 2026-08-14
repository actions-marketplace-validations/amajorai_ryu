// apps/desktop/src/lib/api/pi-config.ts
//
// Typed client for Core's Ryu-managed Pi configuration endpoints
// (`/api/pi-config`). The Ryu agent runs Core's OWN Pi binary against an
// ISOLATED config directory (`PI_CODING_AGENT_DIR`), separate from any Pi the
// user has on their PATH. These endpoints read/write that config so the desktop
// can pick the provider + model from the set Pi supports (per pi.dev docs).
//
// "gateway" provider => Gateway-routed (governed egress, no keys stored in Pi).
// Any other provider  => direct egress to that provider (a deliberate bypass).

import { openSse, type SseMessage } from "@ryuhq/protocol/sse";
import { type ApiTarget, apiUrl, request } from "./client.ts";

/** The current Pi configuration. Never contains secrets. */
export interface PiConfig {
	/** The isolated config directory Core writes (`PI_CODING_AGENT_DIR`). */
	configDir: string;
	model: string | null;
	/** Logical provider id ("gateway" or a built-in/custom provider id). */
	provider: string;
	/** Per-provider routing overrides, keyed by provider id. */
	providerRouting?: Record<string, string>;
	/** "gateway" | "direct" — the ACTIVE provider's effective routing. */
	routing: string;
	thinkingLevel: string | null;
}

/** A provider Pi supports, as surfaced by the catalog endpoint. */
export interface PiProvider {
	/** Whether this provider is the currently-active one. */
	active?: boolean;
	/** Pi `api` type (openai-completions / anthropic-messages / ...). */
	api: string;
	/** Environment variable Pi reads for this provider's key (may be empty). */
	authEnv: string;
	/** "subscription" | "api-key" | "none" (gateway). */
	authKind: string;
	/** Whether a usable credential is already available (auth.json/env/models.json). */
	configured: boolean;
	/** The credit pool this provider's spend attributes to, or `""` for BYOK.
	 *
	 *  A SEGREGATED pool (`cloudflare`, `bedrock`) is where grants land — a
	 *  free-tier or referral grant is spendable on it with no plan at all. The
	 *  residual `openrouter` pool is the one that genuinely needs a subscription,
	 *  because it has no donated allowance behind it. Anything that gates on
	 *  "managed" ALONE will upsell a subscription for credit the user already
	 *  holds. */
	creditPool?: string;
	/** True for user-defined custom providers from models.json. */
	custom: boolean;
	id: string;
	label: string;
	/** True for any Ryu-managed provider (Ryu supplies the capacity, no key
	 *  needed). No longer implies "included with a paid plan" — see
	 *  {@link Provider.creditPool}. */
	managed?: boolean;
	/**
	 * Per-model enable overrides keyed by model id. An id absent from this map
	 * is enabled by default; only explicitly-toggled models appear.
	 */
	modelOverrides?: Record<string, boolean>;
	/** "gateway" | "direct". */
	routing: string;
	/** When true, the routing toggle is fixed (managed/gateway) and disabled. */
	routingLocked?: boolean;
	suggestedModels: string[];
	/** Whether Core can dynamically discover this provider's model list. */
	supportsDiscovery?: boolean;
}

export interface PiCatalog {
	/**
	 * Per-AGENT model visibility, keyed by agent id then model id. An external
	 * agent advertises its own models over ACP rather than through a provider, so
	 * its toggles live here instead of on a {@link PiProvider}. Same rule: an id
	 * absent from the map is enabled.
	 */
	agentModelOverrides?: Record<string, Record<string, boolean>>;
	apiTypes: string[];
	providers: PiProvider[];
	thinkingLevels: string[];
}

/** A missing override is enabled; only an explicit false hides a model. */
export function isPiModelEnabled(
	modelOverrides: Record<string, boolean> | undefined,
	modelId: string
): boolean {
	return modelOverrides?.[modelId] !== false;
}

/**
 * The `provider` value that scopes a model toggle to an AGENT rather than a
 * provider (mirrors Core's `AGENT_OVERRIDE_PREFIX`). Core stores both in one
 * place and keeps the agent scopes out of the provider catalog.
 */
export function agentModelScope(agentId: string): string {
	return `agent:${agentId}`;
}

/**
 * Drop the models an agent has toggled off, but never drop `keep` — the model
 * the surface is CURRENTLY set to. Hiding the active selection would leave a
 * picker with no visible value and no way to see what is running; the settings
 * list is where a user turns it back on.
 */
export function filterEnabledModels<T extends { id: string }>(
	items: T[],
	overrides: Record<string, boolean> | undefined,
	keep?: string | null
): T[] {
	if (!overrides) {
		return items;
	}
	return items.filter(
		(item) => item.id === keep || isPiModelEnabled(overrides, item.id)
	);
}

/** The desired configuration to apply. */
export interface PiConfigInput {
	/** Pi `api` type for a custom provider (defaults to openai-completions). */
	api?: string | null;
	/** Optional api-key credential (written to the isolated auth.json/models.json). */
	apiKey?: string | null;
	/** Optional base URL for a custom OpenAI-compatible provider (Ollama, vLLM, ...). */
	baseUrl?: string | null;
	model?: string | null;
	provider: string;
	thinkingLevel?: string | null;
}

export async function fetchPiConfig(target: ApiTarget): Promise<PiConfig> {
	const data = await request<{ config: PiConfig }>(target, "/api/pi-config");
	return data.config;
}

export async function fetchPiCatalog(target: ApiTarget): Promise<PiCatalog> {
	return await request<PiCatalog>(target, "/api/pi-config/catalog");
}

export async function updatePiConfig(
	target: ApiTarget,
	input: PiConfigInput
): Promise<PiConfig> {
	const data = await request<{ config: PiConfig }>(target, "/api/pi-config", {
		method: "PUT",
		body: input,
	});
	return data.config;
}

/** Credentials/routing to store for a provider WITHOUT making it active. */
export interface ProviderConfigInput {
	/** Pi `api` type for a custom provider (defaults to openai-completions). */
	api?: string | null;
	/** Optional api-key credential (written to the isolated auth.json/models.json). */
	apiKey?: string | null;
	/** Optional base URL for a custom OpenAI-compatible provider. */
	baseUrl?: string | null;
	provider: string;
	/** "gateway" | "direct" — per-provider routing override. */
	routing?: string | null;
}

/**
 * Store credentials/routing for a provider without activating it. Returns the
 * refreshed catalog (the `configured`/`routing` flags may flip).
 */
export async function configureProvider(
	target: ApiTarget,
	input: ProviderConfigInput
): Promise<PiCatalog> {
	return await request<PiCatalog>(target, "/api/pi-config/providers", {
		method: "POST",
		body: input,
	});
}

/** Remove a stored credential / custom provider. Returns the refreshed catalog. */
export async function deleteProvider(
	target: ApiTarget,
	id: string
): Promise<PiCatalog> {
	return await request<PiCatalog>(
		target,
		`/api/pi-config/providers/${encodeURIComponent(id)}`,
		{ method: "DELETE" }
	);
}

/** A model surfaced by dynamic discovery. */
export interface DiscoveredModel {
	id: string;
	name?: string;
}

export interface DiscoverModelsInput {
	/** Pi `api` type of an unsaved custom provider (e.g. "anthropic-messages"). */
	api?: string | null;
	apiKey?: string | null;
	baseUrl?: string | null;
	provider?: string | null;
}

export interface DiscoverModelsResult {
	models: DiscoveredModel[];
	/** "discovery" when the list came from the provider, "fallback" otherwise. */
	source: string;
}

/** Ask Core to enumerate a provider's models (live, with a suggested fallback). */
export async function discoverModels(
	target: ApiTarget,
	input: DiscoverModelsInput
): Promise<DiscoverModelsResult> {
	return await request<DiscoverModelsResult>(
		target,
		"/api/pi-config/discover-models",
		{ method: "POST", body: input }
	);
}

export interface CheckProviderInput {
	/** Pi `api` type of an unsaved custom provider (e.g. "anthropic-messages"). */
	api?: string | null;
	apiKey?: string | null;
	baseUrl?: string | null;
	provider?: string | null;
}

export interface CheckProviderResult {
	error?: string;
	latencyMs: number;
	modelCount: number;
	ok: boolean;
}

/**
 * Live-check a provider's connectivity (one authenticated GET to its models
 * endpoint). Persists nothing; keys are sent to Core only for the probe.
 */
export async function checkProvider(
	target: ApiTarget,
	input: CheckProviderInput
): Promise<CheckProviderResult> {
	return await request<CheckProviderResult>(
		target,
		"/api/pi-config/providers/check",
		{ method: "POST", body: input }
	);
}

export interface SetModelEnabledInput {
	enabled: boolean;
	model: string;
	provider: string;
}

/**
 * Enable/disable a single model within a provider. Returns the refreshed catalog
 * so the model's `modelOverrides` entry reflects the new state.
 */
export async function setModelEnabled(
	target: ApiTarget,
	input: SetModelEnabledInput
): Promise<PiCatalog> {
	return await request<PiCatalog>(
		target,
		"/api/pi-config/providers/model-enabled",
		{ method: "POST", body: input }
	);
}

// ── Subscription OAuth login (ChatGPT / Claude / Copilot) ────────────────────
//
// A subscription provider is connected by completing a real OAuth flow, not by
// storing a key. Core drives pi-ai's own flow modules and streams what they
// produce — an authorization URL, a device code, a prompt awaiting an answer —
// so the login happens in this app instead of a terminal the user never sees.

/** A question the flow is blocked on until {@link answerProviderLogin}. */
export interface PiLoginPrompt {
	message: string;
	/**
	 * Present for a `select` prompt. The answer must be the chosen option's
	 * `id` — the flow matches on the id, not on the label or an index.
	 */
	options?: { id: string; label: string }[];
	placeholder?: string;
	/** "text" | "select" | "manual_code" | … — anything but `select` is free text. */
	type: string;
}

/** One frame of a login flow. `success` and `error` are terminal. */
export interface PiLoginEvent {
	/** `prompt`: the id to quote when answering. */
	id?: string;
	/** `auth_url`: extra guidance from the provider's flow. */
	instructions?: string;
	/** `error`: what went wrong. `progress`/`info`: a status line. */
	message?: string;
	prompt?: PiLoginPrompt;
	/** `success`: the auth.json key that now holds a credential. */
	provider?: string;
	type:
		| "auth_url"
		| "device_code"
		| "error"
		| "info"
		| "progress"
		| "prompt"
		| "success";
	/** `auth_url`: open this to authorize. */
	url?: string;
	/** `device_code`: the code to type on the verification page. */
	userCode?: string;
	/** `device_code`: open this, then enter `userCode`. */
	verificationUri?: string;
}

/**
 * Begin a subscription login. Returns the session id to stream from. Starting a
 * second login for the same provider retires the first — these flows bind fixed
 * localhost callback ports, so two at once cannot both work.
 */
export async function startProviderLogin(
	target: ApiTarget,
	providerId: string
): Promise<{ sessionId: string }> {
	return await request<{ sessionId: string }>(
		target,
		`/api/pi-config/providers/${encodeURIComponent(providerId)}/login`,
		{ method: "POST" }
	);
}

/**
 * Stream a login's events. Events emitted before this attaches are replayed
 * first, so the opening URL or prompt is never missed.
 */
export function openProviderLoginStream(
	target: ApiTarget,
	sessionId: string,
	signal: AbortSignal
): AsyncGenerator<SseMessage<PiLoginEvent>> {
	return openSse<PiLoginEvent>(
		apiUrl(
			target,
			`/api/pi-config/login/${encodeURIComponent(sessionId)}/events`
		),
		{ token: target.token, signal }
	);
}

/** Answer the prompt the flow is waiting on. */
export async function answerProviderLogin(
	target: ApiTarget,
	sessionId: string,
	promptId: string,
	value: string
): Promise<{ accepted: boolean; error?: string }> {
	return await request<{ accepted: boolean; error?: string }>(
		target,
		`/api/pi-config/login/${encodeURIComponent(sessionId)}/answer`,
		{ method: "POST", body: { prompt_id: promptId, value } }
	);
}

/**
 * Abandon a login and kill its flow. Always call this when the dialog closes:
 * a flow left running keeps its callback port bound, and the next attempt then
 * fails to bind.
 */
export async function cancelProviderLogin(
	target: ApiTarget,
	sessionId: string
): Promise<{ cancelled: boolean }> {
	return await request<{ cancelled: boolean }>(
		target,
		`/api/pi-config/login/${encodeURIComponent(sessionId)}/cancel`,
		{ method: "POST" }
	);
}
