// apps/desktop/src/store/useInstallStore.ts
//
// ONE owner of "is this store item's add/lifecycle call in flight", keyed by the
// item's catalog id.
//
// Before this, five surfaces each invented their own flag: the apps catalog
// hook's instance-wide `installing` boolean (which the Store mounts TWICE — the
// first-party feed and the community feed — so an add started in one was
// invisible to the other), the catalog section's write-only `pending` latch, the
// installed list's `Record<string, boolean>`, and the contributed section's local
// `busy`/`pendingId`. The same item could therefore read "Adding…" in the detail
// dialog and "Add" on its own card at the same moment — and a second click on
// that armed card raced the first request into Core's 409 "already installed".
//
// This is deliberately NOT derived from `useDownloadsStore`: a built-in listing
// takes the `POST /api/plugins/:id/install` branch, which is a local store write
// with nothing to download, so a downloads-derived flag would leave most adds
// with no busy state at all. The downloads store stays the enrichment source for
// PERCENT only; this store is the authority for the flag.
//
// Counts, not booleans: an add immediately followed by an enable on the same id
// overlaps, and a plain boolean would let the first call's completion clear the
// second call's flag. `begin`/`end` are a refcount, so the id stays busy until
// every in-flight call for it has settled.

import { create } from "zustand";

interface InstallState {
	/** Mark one in-flight lifecycle call for `id`. Pair with {@link end}. */
	begin: (id: string) => void;
	/** Release one in-flight call for `id`. Safe to call for an unknown id. */
	end: (id: string) => void;
	/** In-flight call count per catalog id (absent = idle). */
	inFlight: Record<string, number>;
	/** Drop every flag (node switch — ids are node-scoped). */
	reset: () => void;
}

export const useInstallStore = create<InstallState>((set) => ({
	inFlight: {},
	begin: (id) =>
		set((s) => ({
			inFlight: { ...s.inFlight, [id]: (s.inFlight[id] ?? 0) + 1 },
		})),
	end: (id) =>
		set((s) => {
			const next = { ...s.inFlight };
			const remaining = (next[id] ?? 0) - 1;
			if (remaining > 0) {
				next[id] = remaining;
			} else {
				delete next[id];
			}
			return { inFlight: next };
		}),
	reset: () => set(() => ({ inFlight: {} })),
}));

/** Non-reactive helpers for callers that are not React components — the catalog
 *  mutations write the store from `onMutate`/`onSettled`, which run outside
 *  render. */
export function beginInstall(id: string): void {
	useInstallStore.getState().begin(id);
}

export function endInstall(id: string): void {
	useInstallStore.getState().end(id);
}

/** Predicate resolving "is this id busy?", for a surface that needs to ask about
 *  many ids (a whole grid of cards) from ONE subscription. Subscribing per card
 *  would be one store subscription per row; this is one per section. */
export function useInstallingLookup(): (id: string) => boolean {
	const inFlight = useInstallStore((s) => s.inFlight);
	return (id: string) => (inFlight[id] ?? 0) > 0;
}

/** Reactive "is this one id busy?" for a single-item surface. */
export function useIsInstalling(id: string): boolean {
	return useInstallStore((s) => (s.inFlight[id] ?? 0) > 0);
}
