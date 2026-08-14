"use client";

// packages/marketplace/src/catalog/installed-filter.tsx
//
// "Show only what I already have", as a SHELL-LEVEL switch rather than a tab.
//
// The Store used to carry an "Added" section: a thirteenth pill that showed every
// installed thing from every realm in one list. It answered the question badly.
// Finding an installed model meant leaving the Models tab (with its size badges,
// its quant picker, its modality filters) for a generic list that had none of
// them, and the tab strip paid for it with a pill that was not a category.
//
// Inverted, it is one toggle in the chrome: Models still renders Models, Apps
// still renders Apps, and the toggle narrows whichever one you are on to the rows
// you already installed. Every section reads it from this context, so a section
// added later opts in with one hook call and no shell change.
//
// Sections that ALREADY own an installed-only filter (Models and Skills each ship
// one inside their filter panel) OR the two together rather than replacing it —
// the shell switch is a floor, not an override, so flipping it on cannot silently
// clear a filter the user set in the panel.

import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
} from "react";

const InstalledOnlyContext = createContext(false);

/** Narrow every catalog section beneath this to installed rows. */
export function InstalledOnlyProvider({
	children,
	value,
}: {
	children: ReactNode;
	value: boolean;
}) {
	return (
		<InstalledOnlyContext.Provider value={value}>
			{children}
		</InstalledOnlyContext.Provider>
	);
}

/**
 * Is the shell's "installed only" switch on? `false` on any surface that does not
 * mount the provider (the web marketplace, where nothing is installed), so a
 * section can call this unconditionally.
 */
export function useInstalledOnly(): boolean {
	return useContext(InstalledOnlyContext);
}

/**
 * Push the shell switch into a section that already owns an `installedOnly`
 * filter of its own (Models, Skills) — where the flag narrows the FETCH, not the
 * rendered page, so filtering the returned array here would only hide rows the
 * server already paged past.
 *
 * Only EDGES are pushed. A plain `useEffect(() => set(shell), [shell])` would
 * re-assert the shell's value every time `set` changed identity — both hooks
 * rebuild their setters on each refetch — and a user unticking the section's own
 * checkbox would find it ticked again a moment later. The ref starts `false`
 * because that is both hooks' initial state, so a section mounted while the shell
 * switch is already on still gets the first push.
 */
export function useSyncInstalledOnly(setInstalledOnly: (on: boolean) => void) {
	const shell = useInstalledOnly();
	const last = useRef(false);
	useEffect(() => {
		if (last.current === shell) {
			return;
		}
		last.current = shell;
		setInstalledOnly(shell);
	}, [shell, setInstalledOnly]);
}
