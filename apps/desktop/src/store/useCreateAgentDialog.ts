import { create } from "zustand";

// A tiny global so any surface can open "New agent". Mirrors
// `useAgentAutoDialog`: the dialog is rendered ONCE (in App.tsx) and reads this
// store, so the four entry points that offer agent creation — the create menu,
// the sidebar, the empty-tabs state and the composer's agent picker — all drive
// the same instance instead of each carrying their own copy.
interface CreateAgentDialogState {
	/** Whether the create-agent dialog is open. */
	open: boolean;
	/** Open the dialog. */
	openCreateAgent: () => void;
	/** Controlled open/close passthrough for the dialog's onOpenChange. */
	setOpen: (open: boolean) => void;
}

export const useCreateAgentDialog = create<CreateAgentDialogState>((set) => ({
	open: false,
	openCreateAgent: () => set({ open: true }),
	setOpen: (open) => set({ open }),
}));
