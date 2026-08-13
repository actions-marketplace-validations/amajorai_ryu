// apps/desktop/src/lib/query-client.ts
//
// App-wide TanStack Query client. Catalog data (models, skills) changes slowly,
// so we keep a generous staleTime — revisiting a model you already opened is then
// instant (served from cache) instead of refetching from Core/Hugging Face on
// every navigation. Window-focus refetch is off by DEFAULT because this is a
// desktop shell, not a dashboard that needs to chase live data; the few queries
// that must chase it (git status / worktree state — see `useGitStatus.ts`) opt
// back in per query.

import { focusManager, QueryClient } from "@tanstack/react-query";

// TanStack v5's focus manager listens for `visibilitychange` and NOTHING else
// (v4's window `focus` listener was dropped). In a browser tab that is enough —
// switching tabs hides the document. In a desktop window it is not: cmd-tabbing
// from Ryu to a terminal leaves the window visible, so `document.visibilityState`
// never changes and TanStack never considers the app re-focused.
//
// That is exactly the trip a user makes to run git by hand, so a refetch-on-focus
// that only fires on visibility would miss every out-of-app commit — the whole
// reason `useGitStatus` opts into it. Bind real window focus as well.
//
// Deliberately one-directional: focus/visible mark the app focused, but nothing
// here marks it UNfocused. A missed "unfocused" only costs a little polling; a
// missed "focused" (if a webview turned out not to emit one) would silently
// suspend every interval, which is the failure this file exists to avoid.
focusManager.setEventListener((handleFocus) => {
	if (typeof window === "undefined") {
		return;
	}
	const onFocus = () => handleFocus(true);
	const onVisibility = () => {
		if (document.visibilityState === "visible") {
			handleFocus(true);
		}
	};
	window.addEventListener("focus", onFocus, false);
	window.addEventListener("visibilitychange", onVisibility, false);
	return () => {
		window.removeEventListener("focus", onFocus);
		window.removeEventListener("visibilitychange", onVisibility);
	};
});

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 5 * 60 * 1000,
			gcTime: 30 * 60 * 1000,
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});
