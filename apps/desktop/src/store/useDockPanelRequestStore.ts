import { create } from "zustand";

export interface DockPanelRequest {
	kind: string;
	label: string;
	nonce: number;
}

interface DockPanelRequestState {
	clear: () => void;
	open: (kind: string, label: string) => void;
	pending: DockPanelRequest | null;
}

/** Programmatic seam for focusing an app-contributed panel in the right dock. */
export const useDockPanelRequestStore = create<DockPanelRequestState>(
	(set) => ({
		pending: null,
		open: (kind, label) =>
			set((state) => ({
				pending: {
					kind,
					label,
					nonce: (state.pending?.nonce ?? 0) + 1,
				},
			})),
		clear: () => set({ pending: null }),
	})
);
