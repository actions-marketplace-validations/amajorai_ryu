// packages/marketplace/src/likes/likes-provider.tsx
//
// The React binding over `LikesStore`. Mounted automatically by
// `MarketplaceHostProvider`, so a surface that already provides the money layer
// gets likes with no extra wiring — and a surface that does not (storyboard,
// test harnesses) renders no heart at all rather than a dead one.
//
// The batching lives in the store, not here: every card calls `useItemLike`, and
// the sixty registrations that produces in one commit collapse into ONE bulk
// request. A per-card fetch for a 60-item grid is the thing this exists to stop.

import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import { sileo } from "sileo";
import type { LikeView, MarketplaceLikesService } from "./likes-store.ts";
import { LikesStore } from "./likes-store.ts";

interface LikesContextValue {
	canLike: () => boolean;
	onRequireAuth?: () => void;
	store: LikesStore;
}

const LikesContext = createContext<LikesContextValue | null>(null);

/**
 * Mount one store for the whole surface. `service` absent ⇒ no provider value,
 * and every `useItemLike` reports `available: false`, which is what hides the
 * control instead of showing a heart that cannot count.
 */
export function LikesProvider({
	service,
	children,
}: {
	service?: MarketplaceLikesService;
	children: ReactNode;
}) {
	// One store per provider instance. Deliberately keyed on the service identity
	// so a host swapping its transport (sign-in / node change) starts clean rather
	// than carrying another session's `likedByMe` flags.
	const value = useMemo<LikesContextValue | null>(() => {
		if (!service) {
			return null;
		}
		const store = new LikesStore(service, () => {
			sileo.error({ title: "Could not update your like." });
		});
		return {
			store,
			canLike: service.canLike,
			onRequireAuth: service.onRequireAuth,
		};
	}, [service]);

	useEffect(() => () => value?.store.dispose(), [value]);

	return (
		<LikesContext.Provider value={value}>{children}</LikesContext.Provider>
	);
}

/** What one card gets back. `available: false` ⇒ render nothing. */
export interface ItemLikeState extends LikeView {
	available: boolean;
	/** True when a write would be refused for want of a session. The control is
	 *  still rendered and still clickable — it prompts sign-in. */
	needsAuth: boolean;
	toggle: () => void;
}

const UNAVAILABLE: ItemLikeState = {
	available: false,
	count: 0,
	liked: false,
	loading: false,
	needsAuth: false,
	toggle: () => {
		// no provider mounted — nothing to toggle
	},
};

/**
 * Read (and toggle) one listing's like state.
 *
 * `seed` is the count (+ optionally the caller's own liked flag) a LIST response
 * already carried — `likeCount` / `likedByMe` on a catalog card. Pass it whenever
 * the surface has it: a fully-seeded card needs no request at all and paints its
 * true liked state on the FIRST render instead of flashing from unliked to liked
 * when a second request lands. Omit `liked` (or pass null) when the count came
 * from a read that had no session attached — the count still seeds, and only the
 * flag is resolved.
 */
export function useItemLike(
	namespace: string | null | undefined,
	seed?: { count: number; liked?: boolean | null } | null
): ItemLikeState {
	const ctx = useContext(LikesContext);
	const key = namespace?.trim().toLowerCase() || "";
	const store = ctx?.store ?? null;

	// Seed BEFORE the registration effect so a seeded namespace never schedules a
	// read. `seed` is a fresh object every render, so the values are read through
	// a ref rather than depended on.
	const seedRef = useRef(seed);
	seedRef.current = seed;

	useEffect(() => {
		if (!(store && key)) {
			return;
		}
		const current = seedRef.current;
		if (current) {
			store.seed(key, current.count, current.liked ?? null);
		}
		store.register(key);
	}, [store, key]);

	const view = useSyncExternalStore(
		store ? store.subscribe : noopSubscribe,
		() => (store && key ? store.getView(key) : UNAVAILABLE),
		() => (store && key ? store.getView(key) : UNAVAILABLE)
	);

	const canLike = ctx?.canLike;
	const onRequireAuth = ctx?.onRequireAuth;

	return useMemo(() => {
		if (!(store && key && ctx)) {
			return UNAVAILABLE;
		}
		return {
			available: true,
			count: view.count,
			liked: view.liked,
			loading: view.loading,
			// Advisory only, and evaluated at render: use it to explain, never to
			// gate. The authoritative check is the one inside `toggle`.
			needsAuth: !canLike?.(),
			toggle: () => {
				// Read the session AT CLICK TIME, not when this object was memoized.
				// A surface can learn it has a session after the first render (the web
				// host writes its flag in an effect), and a captured `false` would
				// have left every card permanently prompting a signed-in user to
				// sign in.
				if (!canLike?.()) {
					// A signed-out click PROMPTS rather than silently doing nothing.
					onRequireAuth?.();
					return;
				}
				store.toggle(key);
			},
		};
	}, [store, key, ctx, canLike, onRequireAuth, view]);
}

/** `useSyncExternalStore` still needs a subscribe function when there is no
 *  store; a module-level no-op keeps its identity stable across renders. */
function noopSubscribe(): () => void {
	return () => {
		// nothing to unsubscribe from
	};
}
