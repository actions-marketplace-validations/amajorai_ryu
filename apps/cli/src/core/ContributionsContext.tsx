/* @jsxImportSource @opentui/react */
// ContributionsContext exposes the enabled plugins' declarative `views` to every
// surface, fetched ONCE per node instead of once per screen.
//
// Five surfaces plus the command palette ask "is there a contributed view for me?",
// and the answer is the same list for all of them, so the read lives here (the
// CoreContext precedent: shared node state, primitives in the value so effects can
// depend on them). Best-effort by design: an old Core without the endpoint, an
// unreachable node, or a malformed payload all resolve to an empty list, which
// means every surface simply keeps rendering its built-in screen.
//
// The list is refetched on a node switch and on demand via `reload()` — an action
// that enables/disables a plugin changes the feed, and Core broadcasts that on the
// `system:plugins` realtime room the desktop subscribes to; the terminal does not
// hold a realtime subscription today, so `reload()` is the manual seam.

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useCore } from "./CoreContext.tsx";
import {
	type ContributedView,
	fetchContributedViews,
	viewClaimingSurface,
} from "./contributions.ts";

interface ContributionsContextValue {
	/** True until the first fetch settles. The generic `/plugin-view` surface shows a
	 *  spinner on it rather than claiming the view is missing; the built-in surfaces
	 *  deliberately do NOT gate on it — they render their own screen immediately and
	 *  swap once a claim arrives, which beats a shell-wide loading flash. */
	loading: boolean;
	/** Refetch the feed (after a plugin enable/disable, or on user request). */
	reload: () => void;
	/** Declarative views contributed by the enabled plugins targeting this surface. */
	views: ContributedView[];
}

/** Stable empty payload so an unreachable Core yields an identical reference every
 *  render — keeps consumer effects from re-running on nothing. */
const EMPTY: ContributedView[] = [];

const ContributionsContext = createContext<ContributionsContextValue | null>(
	null
);

export function ContributionsProvider({ children }: { children: ReactNode }) {
	const { target, url, token } = useCore();
	const [views, setViews] = useState<ContributedView[]>(EMPTY);
	const [loading, setLoading] = useState(true);
	const [reloadToken, setReloadToken] = useState(0);

	const reload = useCallback(() => setReloadToken((n) => n + 1), []);

	useEffect(() => {
		let cancelled = false;
		const controller = new AbortController();
		setLoading(true);
		fetchContributedViews(target, controller.signal)
			.then((next) => {
				if (!cancelled) {
					setViews(next.length === 0 ? EMPTY : next);
				}
			})
			.catch(() => {
				// Best-effort: a missing endpoint / unreachable node leaves the shell
				// on its built-in surfaces rather than surfacing an error the user
				// cannot act on.
				if (!cancelled) {
					setViews(EMPTY);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
			controller.abort();
		};
		// url/token are primitives; including them refetches on a node switch.
	}, [target, url, token, reloadToken]);

	const value = useMemo<ContributionsContextValue>(
		() => ({ views, loading, reload }),
		[views, loading, reload]
	);
	return (
		<ContributionsContext.Provider value={value}>
			{children}
		</ContributionsContext.Provider>
	);
}

/** Read the enabled plugins' declarative views. Returns the stable empty payload
 *  outside a provider so a surface rendered in isolation (tests, one-off harnesses)
 *  degrades to its built-in screen instead of throwing. */
export function useContributions(): ContributionsContextValue {
	return (
		useContext(ContributionsContext) ?? {
			views: EMPTY,
			loading: false,
			reload: () => undefined,
		}
	);
}

/** The contributed view that CLAIMS a built-in surface (`viewClaimingSurface`, which
 *  matches the reserved `surface:<id>` view id), or undefined when no enabled app
 *  declares one. This is the ONE call a built-in surface makes to hand itself over:
 *  `const contributed = useSurfaceView("calendar")` — render the contributed view
 *  when it is there, keep the hand-written screen when it is not. Nothing about the
 *  app is named on this side of the seam. */
export function useSurfaceView(surfaceId: string): ContributedView | undefined {
	const { views } = useContributions();
	return viewClaimingSurface(views, surfaceId);
}
