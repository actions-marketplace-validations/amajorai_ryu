// apps/desktop/src/hooks/useCapabilityLayers.ts
//
// Backs the "Layers" block in the node selector: the TOOLKIT capabilities on a
// node (search / extract / crawl / browser / computer / memory / document parsing
// / whatever a third-party app declares) plus the swap that pins one to a
// provider app.
//
// Joins Core's `/api/capabilities` read model into one row per capability, with
// the bound provider resolved from `providers` so a caller never has to do the
// id → provider lookup itself.
//
// Two deliberate behaviours:
//
//   - NON-TOOLKIT capabilities are filtered out. `toolkit` is COMPUTED by Core:
//     true when a host facade owns the capability (the verbs, or the parse route,
//     stay the same whichever provider is bound) or when two or more known
//     manifests provide it. Anything else is one app's private wiring to its own
//     sidecar, and there is no choice to render.
//
//     This used to filter on `selectable`, which is a different question with a
//     confusingly similar name: that is the BINDER's tie-break flag, a unanimity
//     check across a capability's providers, and it is trivially true when there
//     is only one provider. So `news.crud`, `plan.review`, `reasoning.check` and
//     `tuition.crud` all became "toolkits" in the dropdown just by copying the
//     flag into a manifest.
//   - A FAILED read yields an empty list, not an error. An older Core 404s on
//     `/api/capabilities`; the node dropdown's rule for that is "no layer rather
//     than a fake one" (see the sandbox layer in NodeSelector).
//
// NOT `useAgentCapabilities` — that reports one agent's tool/vision support and
// is unrelated to capability→provider binding.

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import {
	type CapabilityProvider,
	fetchCapabilityLayers,
	setCapabilityBinding,
} from "@/src/lib/api/capability-layers.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";

/** One toolkit capability, ready to render as a swap layer. */
export interface CapabilityLayerEntry {
	/** The bound provider row, resolved out of `providers`. `null` when unresolved. */
	/**
	 * Providers that serve this capability but are not enabled yet. Rendered as an
	 * "enable it" list, which is the only thing a toolkit with no enabled provider
	 * can usefully offer.
	 */
	available: CapabilityProvider[];
	/** The provider id currently serving this capability, or `null` if unresolved. */
	bound: string | null;
	boundProvider: CapabilityProvider | null;
	/** The capability name (`"web.search"`, `"memory"`, …). */
	capability: string;
	/** True when the pick is an explicit user override, not Core's auto-pick. */
	overridden: boolean;
	/** Every enabled app that provides this capability, sorted by id. */
	providers: CapabilityProvider[];
	/**
	 * The capability's display name as its providers declare it (`"Search"`,
	 * `"Document Parsing"`), or `null` when none does.
	 *
	 * The reason the picker no longer needs a label column of its own: a closed
	 * client-side table could only ever name the capabilities that shipped with it,
	 * so a third-party toolkit rendered as its raw dotted id. App-supplied text —
	 * clamp it, never render it as markup.
	 */
	title: string | null;
}

export interface UseCapabilityLayersResult {
	/** Selectable capabilities only; empty while loading or on an older Core. */
	layers: CapabilityLayerEntry[];
	loading: boolean;
	refresh: () => Promise<void>;
	/**
	 * Pin `capability` to `providerId` and reload. Rejects with a
	 * `CapabilityBindingConflictError` when Core refuses the change (409) —
	 * callers should surface `binding_error`, not swallow it.
	 */
	select: (capability: string, providerId: string) => Promise<void>;
}

export function useCapabilityLayers(
	target: ApiTarget,
	enabled: boolean
): UseCapabilityLayersResult {
	const query = useQuery({
		enabled,
		queryFn: async (): Promise<CapabilityLayerEntry[]> => {
			// Absent on an older Core → no layers rather than a broken section.
			const model = await fetchCapabilityLayers(target).catch(() => null);
			if (!model) {
				return [];
			}
			// `toolkit`, not `selectable`. The latter is the binder's tie-break flag —
			// a unanimity check across providers that is trivially true for a sole
			// provider — so four app-private capabilities were rendering here as
			// swappable layers.
			return model.capabilities
				.filter((c) => c.toolkit)
				.map(
					(c): CapabilityLayerEntry => ({
						available: c.available,
						bound: c.bound,
						boundProvider: c.providers.find((p) => p.id === c.bound) ?? null,
						capability: c.capability,
						overridden: c.overridden,
						providers: c.providers,
						title: c.title,
					})
				);
		},
		queryKey: ["node-capability-layers", target.url],
		refetchInterval: 30_000,
		retry: false,
	});

	const refetch = query.refetch;
	const refresh = useCallback(async () => {
		await refetch();
	}, [refetch]);

	// Primitives, not the object: `target` is a fresh literal on most renders, so
	// depending on it directly would hand every consumer a new `select` each pass.
	const url = target.url;
	const token = target.token;
	const userJwt = target.userJwt;
	const select = useCallback(
		async (capability: string, providerId: string) => {
			await setCapabilityBinding(
				{ token, url, userJwt },
				capability,
				providerId
			);
			await refetch();
		},
		[refetch, token, url, userJwt]
	);

	return {
		layers: query.data ?? [],
		// `isPending` (not `isLoading`) stays true FOREVER on a disabled query, so a
		// consumer gated on `enabled` would render a permanent spinner.
		loading: query.isLoading,
		refresh,
		select,
	};
}
