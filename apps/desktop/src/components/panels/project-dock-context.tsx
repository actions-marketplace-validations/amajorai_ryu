// apps/desktop/src/components/panels/project-dock-context.tsx
//
// Slot registration for project-scoped dock tab content. The host (Layout)
// portals shared TabContent trees into whichever focused chat is showing that
// tab; this module stays free of panel implementations so WorkspacePanels can
// import it without a cycle.

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";

interface SlotRegistration {
	el: HTMLElement;
	seq: number;
}

interface ProjectDockSlotsValue {
	/** Return the current portal target for a project dock tab, if any. */
	getSlot: (uid: string) => HTMLElement | null;
	registerSlot: (uid: string, el: HTMLElement) => void;
	/** Subscribe to slot map changes (host re-portals on bump). */
	slotEpoch: number;
	unregisterSlot: (uid: string, el: HTMLElement) => void;
}

const ProjectDockSlotsContext = createContext<ProjectDockSlotsValue | null>(
	null
);

const NOOP_SLOTS: ProjectDockSlotsValue = {
	getSlot: () => null,
	slotEpoch: 0,
	registerSlot: () => {
		/* no host */
	},
	unregisterSlot: () => {
		/* no host */
	},
};

export function useProjectDockSlots(): ProjectDockSlotsValue {
	return useContext(ProjectDockSlotsContext) ?? NOOP_SLOTS;
}

export function ProjectDockSlotsProvider({
	children,
}: {
	children: ReactNode;
}) {
	const slotsRef = useRef<Record<string, SlotRegistration>>({});
	const seqRef = useRef(0);
	const [slotEpoch, setSlotEpoch] = useState(0);

	const registerSlot = useCallback((uid: string, el: HTMLElement) => {
		seqRef.current += 1;
		const seq = seqRef.current;
		slotsRef.current[uid] = { el, seq };
		setSlotEpoch((n) => n + 1);
	}, []);

	const unregisterSlot = useCallback((uid: string, el: HTMLElement) => {
		const cur = slotsRef.current[uid];
		if (!cur || cur.el !== el) {
			return;
		}
		delete slotsRef.current[uid];
		setSlotEpoch((n) => n + 1);
	}, []);

	const getSlot = useCallback((uid: string) => {
		return slotsRef.current[uid]?.el ?? null;
	}, []);

	const value = useMemo(
		() => ({ getSlot, slotEpoch, registerSlot, unregisterSlot }),
		[getSlot, slotEpoch, registerSlot, unregisterSlot]
	);

	return (
		<ProjectDockSlotsContext.Provider value={value}>
			{children}
		</ProjectDockSlotsContext.Provider>
	);
}
