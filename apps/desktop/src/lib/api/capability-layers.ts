// apps/desktop/src/lib/api/capability-layers.ts
//
// Typed client for Core's CAPABILITY LAYER surface — `/api/capabilities` (the
// read model) and `/api/capabilities/bindings` (the user's override map).
//
// A "layer" here is one capability (`web.search`, `browser.control`, `memory`, …)
// that several enabled apps may provide at once. Core resolves it with a ladder:
//
//     user override > sole provider > declared default > lowest id
//
// and the middle two rungs only apply when EVERY provider of the capability
// declares `"selectable": true`. That is why the read model ships `selectable`
// per capability: a non-selectable capability with 2+ providers resolves to
// nothing at all, so offering a picker for it would be a lie.
//
// NOT to be confused with `./capabilities.ts` + `useAgentCapabilities` — those
// describe one AGENT's tool/vision report and share nothing with this module.
//
// # Why the PUT is not a plain `request()` call
//
// `PUT /api/capabilities/bindings` REPLACES the whole override map (there is no
// PATCH), and it answers 409 with `{error, plugin, binding_error}` when the new
// map would leave an enabled consumer unbound. `request()`'s `ApiError` only
// carries `error`, dropping `plugin` and `binding_error` — the two fields that
// say WHICH app broke and HOW. So the write goes through a raw fetch composed of
// the same exported helpers (`apiUrl` / `makeHeaders` / `identityHeaders`) and
// throws a typed {@link CapabilityBindingConflictError} instead. The route is
// node-bearer gated and never reads the verified-caller extension, so the node
// token plus the attribution headers is the complete, correct header set.

import {
	type ApiTarget,
	apiUrl,
	identityHeaders,
	makeHeaders,
	request,
} from "./client.ts";

const CAPABILITIES_PATH = "/api/capabilities";
const BINDINGS_PATH = "/api/capabilities/bindings";

/** One candidate provider of a capability (an enabled app that declares it). */
export interface CapabilityProvider {
	/** The provider app's manifest id (`com.ryu.exa`) — the override value. */
	id: string;
	/** Whether the provider declares itself the default pick for this capability. */
	isDefault: boolean;
	/** Display name. */
	name: string;
	/**
	 * Whether this provider serves any verb at all.
	 *
	 * A provider may declare a capability with no verb bindings yet — `agentbrowser`
	 * does, because its tool names live in an npm package and cannot be read from the
	 * repo. Selecting one makes every verb of that layer vanish with no error, so the
	 * picker must not offer it as an equal choice.
	 */
	servesVerbs: boolean;
	/**
	 * What this provider acts on, when the capability controls a machine or an
	 * environment. `null` = not applicable (`web.search`, `memory`) or undeclared.
	 *
	 * Not decoration. Within one capability, providers that differ here are not
	 * interchangeable in the way "swap" implies: `computer.control`'s two providers
	 * type on two different computers — `ghost` on this one, `bytebot` on the
	 * desktop its daemon runs on. Rendering that swap like a search-provider swap
	 * tells the user something false.
	 */
	target: ProviderTarget | null;
	/** The facade verb ids this provider can serve (`web__search`, …). */
	verbs: string[];
	/** The capability version it serves. */
	version: string;
}

/** What a provider acts on — see {@link CapabilityProvider.target}. */
export type ProviderTarget = "local-machine" | "remote-desktop";

/** One capability plus everything a picker needs to render and change it. */
export interface CapabilityLayer {
	/**
	 * Providers that serve this capability but are NOT enabled.
	 *
	 * Empty for a fully-enabled capability. Non-empty with an empty
	 * {@link CapabilityLayer.providers} is the "nothing serves this yet, but
	 * something could" state, which the picker renders as an install row rather
	 * than hiding: every `web.search` provider ships opt-in, so that toolkit used to
	 * be invisible on a fresh install with nothing pointing at the Store.
	 */
	available: CapabilityProvider[];
	/** The provider currently bound, or `null` when the capability does not resolve. */
	bound: string | null;
	/** The capability name (`"web.search"`, `"memory"`, …). */
	capability: string;
	/** True when the current binding comes from an explicit override, not the auto-pick. */
	overridden: boolean;
	/** Every candidate provider, sorted by id. */
	providers: CapabilityProvider[];
	/** Whether many providers may be enabled at once and one is picked. */
	selectable: boolean;
}

/** One stable facade verb the capability router currently serves. */
export interface CapabilityVerb {
	capability: string;
	id: string;
	provider: string;
	/** The provider tool the verb is mapped onto. */
	target: string;
}

/** The `/api/capabilities` read model. */
export interface CapabilityReadModel {
	capabilities: CapabilityLayer[];
	verbs: CapabilityVerb[];
}

interface CapabilityProviderWire {
	id: string;
	is_default?: boolean;
	name?: string;
	serves_verbs?: boolean;
	target?: string;
	verbs?: string[];
	version?: string;
}

interface CapabilityLayerWire {
	available?: CapabilityProviderWire[];
	bound?: string | null;
	capability: string;
	overridden?: boolean;
	providers?: CapabilityProviderWire[];
	selectable?: boolean;
}

interface CapabilityVerbWire {
	capability?: string;
	id: string;
	provider?: string;
	target?: string;
}

/**
 * Thrown when Core REFUSES a binding change (409): the requested override would
 * leave an enabled consumer unbound or ambiguous. Carries the offending
 * `plugin` and the stable `bindingError` code alongside the human message, so a
 * caller can say what actually broke instead of "request failed".
 */
export class CapabilityBindingConflictError extends Error {
	/** Stable machine code from Core (`ambiguous`, `override_not_provider`, …). */
	readonly bindingError: string;
	/** The enabled plugin whose requirement the change would break. */
	readonly plugin: string;

	constructor(message: string, plugin: string, bindingError: string) {
		super(message);
		this.name = "CapabilityBindingConflictError";
		this.plugin = plugin;
		this.bindingError = bindingError;
	}
}

/**
 * Human sentence for a failed layer swap, keeping Core's `binding_error` code and
 * the blocking plugin visible. Lives here so every surface words a refusal the
 * same way instead of stringifying the error and losing both fields.
 */
export function describeBindingFailure(
	error: unknown,
	providerName: string
): string {
	if (error instanceof CapabilityBindingConflictError) {
		const where = error.plugin ? ` (${error.plugin})` : "";
		return `${error.message}${where} · ${error.bindingError}`;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return `Couldn't switch to ${providerName}`;
}

/** One wire provider to its typed form. Shared by `providers` and `available`. */
function toProvider(p: CapabilityProviderWire): CapabilityProvider {
	return {
		id: p.id,
		isDefault: p.is_default ?? false,
		name: p.name ?? p.id,
		// Fall back to the verb list rather than defaulting to `true`: an older Core
		// that does not send the flag still reports verbs, and treating "unknown" as
		// serveable is the direction that silently turns a layer off.
		servesVerbs: p.serves_verbs ?? (p.verbs ?? []).length > 0,
		// Only the two values the contract defines. An unknown string from a newer
		// Core becomes `null` (= "say nothing") rather than being rendered raw, since
		// this label makes a claim about the user's own machine and a wrong one is
		// worse than none.
		target:
			p.target === "local-machine" || p.target === "remote-desktop"
				? p.target
				: null,
		verbs: p.verbs ?? [],
		version: p.version ?? "",
	};
}

/** Read every capability, its candidate providers, and the current pick. */
export async function fetchCapabilityLayers(
	target: ApiTarget
): Promise<CapabilityReadModel> {
	const json = await request<{
		capabilities?: CapabilityLayerWire[];
		verbs?: CapabilityVerbWire[];
	}>(target, CAPABILITIES_PATH);
	return {
		capabilities: (json.capabilities ?? []).map(
			(c): CapabilityLayer => ({
				available: (c.available ?? []).map(toProvider),
				bound: c.bound ?? null,
				capability: c.capability,
				overridden: c.overridden ?? false,
				providers: (c.providers ?? []).map(toProvider),
				selectable: c.selectable ?? false,
			})
		),
		verbs: (json.verbs ?? []).map(
			(v): CapabilityVerb => ({
				capability: v.capability ?? "",
				id: v.id,
				provider: v.provider ?? "",
				target: v.target ?? "",
			})
		),
	};
}

/** The current `capability → provider id` override map (empty = pure auto-pick). */
export async function fetchCapabilityBindings(
	target: ApiTarget
): Promise<Record<string, string>> {
	const json = await request<{ overrides?: Record<string, string> }>(
		target,
		BINDINGS_PATH
	);
	return json.overrides ?? {};
}

/** Decode Core's 409 body into a typed conflict, or fall back to a plain Error. */
async function bindingWriteError(resp: Response): Promise<Error> {
	const status = resp.status;
	const text = await resp.text().catch(() => "");
	try {
		const body = JSON.parse(text) as {
			binding_error?: string;
			error?: string;
			plugin?: string;
		};
		if (status === 409 && typeof body.binding_error === "string") {
			return new CapabilityBindingConflictError(
				body.error ?? "Core refused this layer change",
				body.plugin ?? "",
				body.binding_error
			);
		}
		if (typeof body.error === "string") {
			return new Error(body.error);
		}
	} catch {
		// Non-JSON error body — fall through to the status line.
	}
	return new Error(`${BINDINGS_PATH} failed: ${status}`);
}

/**
 * REPLACE the whole override map. Private on purpose: a caller that reaches this
 * with only its own key wipes every other layer's selection. Go through
 * {@link setCapabilityBinding}, which reads-merges-writes.
 */
async function replaceCapabilityBindings(
	target: ApiTarget,
	overrides: Record<string, string>
): Promise<Record<string, string>> {
	const resp = await fetch(apiUrl(target, BINDINGS_PATH), {
		body: JSON.stringify({ overrides }),
		headers: { ...makeHeaders(target.token), ...identityHeaders() },
		method: "PUT",
	});
	if (!resp.ok) {
		throw await bindingWriteError(resp);
	}
	const text = await resp.text();
	if (!text) {
		return overrides;
	}
	try {
		const body = JSON.parse(text) as { overrides?: Record<string, string> };
		return body.overrides ?? overrides;
	} catch {
		return overrides;
	}
}

/**
 * Serializes every binding write on this client. The read-merge-write below is
 * not atomic on the server, so two quick picks on DIFFERENT layers could
 * interleave their GET/PUT and silently drop one. `NodeLayerMenu` only blocks
 * concurrent clicks WITHIN one submenu, so the cross-layer case is real.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function serializeWrite<T>(task: () => Promise<T>): Promise<T> {
	const run = writeQueue.then(task, task);
	// Keep the chain alive after a rejection, without swallowing it for the caller.
	writeQueue = run.then(
		() => undefined,
		() => undefined
	);
	return run;
}

/**
 * Pin `capability` to `providerId`, preserving every OTHER capability's override.
 *
 * The endpoint is a REPLACE, so this reads the current map, merges the single
 * change, and writes the whole thing back. Doing the merge here (rather than in a
 * hook or a component) is deliberate: there is then no reachable code path that
 * PUTs a partial map.
 *
 * Throws {@link CapabilityBindingConflictError} on Core's 409 refusal.
 */
export function setCapabilityBinding(
	target: ApiTarget,
	capability: string,
	providerId: string
): Promise<Record<string, string>> {
	return serializeWrite(async () => {
		const current = await fetchCapabilityBindings(target);
		if (current[capability] === providerId) {
			return current;
		}
		return await replaceCapabilityBindings(target, {
			...current,
			[capability]: providerId,
		});
	});
}
