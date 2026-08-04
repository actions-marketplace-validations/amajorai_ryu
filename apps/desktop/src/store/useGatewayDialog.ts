import { create } from "zustand";

// The named sections of the Gateway settings dialog. Kept here (not in
// GatewayDialog.tsx) so external openers — the command palette, deep links, the
// Settings page — can request a specific section without importing the dialog
// component (which would pull the whole gateway UI into those entry points).
// Node/gateway-level sections. Beyond the gateway-policy sections this dialog has
// always owned, it also hosts the node-level CORE-INFRA tabs that used to live in
// the App Settings dialog (they configure the whole node, not the per-user desktop
// client, and are not apps): connections, email/alerts, privacy, storage, updates,
// health, and the Danger Zone. App settings (meetings, memory, quests, predict, …)
// are NOT static sections — apps register them via the manifest and they render
// dynamically under the Apps/Plugins headers (`app:<id>` / `plugin:<id>` values).
export type GatewaySection =
	| "overview"
	| "workspace"
	| "defaults"
	| "providers"
	| "routing"
	| "guardrails"
	| "budgets"
	| "keys"
	| "integrations"
	// The node's network surface (mesh / Tailscale / Headscale), extracted from
	// Integrations into its own tab.
	| "network"
	| "usage"
	| "audit"
	| "evals"
	// Moved from the App Settings dialog (node-level Core infra, not apps):
	| "connections"
	| "email-alerts"
	| "privacy"
	| "storage"
	// Who may talk to this node: pending device-pairing approvals, already-paired
	// devices, and the node's own access token.
	| "access"
	// Per-resource permission exceptions (which team may do what, where).
	| "permissions"
	// Which app extracts text from uploaded documents (the node-wide
	// `document.parse` binding) and the ceiling it enforces. Node-level, not
	// per-user: one provider is bound per node and serves every Space and every
	// chat attachment on it.
	| "parsing"
	| "updates"
	| "health"
	| "danger";

interface GatewayDialogState {
	/** Whether the Gateway dialog is open. */
	open: boolean;
	/**
	 * Open the dialog at a section. A known {@link GatewaySection}, or a dynamic
	 * app/plugin entity value (`app:<id>` / `plugin:<id>`) so a deep link can open a
	 * specific app's settings. Defaults to the overview.
	 */
	openGateway: (section?: GatewaySection | (string & {})) => void;
	/** The section to show when it opens. */
	section: string;
	/** Controlled open/close passthrough for the dialog's onOpenChange. */
	setOpen: (open: boolean) => void;
}

// A tiny global so any surface can open the Gateway dialog at a chosen section.
// The dialog itself is rendered once (in NodeSelector) and reads this store, so
// there is a single instance regardless of how many places trigger it.
export const useGatewayDialog = create<GatewayDialogState>((set) => ({
	open: false,
	section: "overview",
	openGateway: (section = "overview") => set({ open: true, section }),
	setOpen: (open) => set({ open }),
}));
