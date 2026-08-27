// apps/desktop/src/components/panels/ProjectDockHost.tsx
//
// Mounts once under Layout. Keeps project dock tab content alive across chat
// switches and portals it into the focused chat's dock slot.

import { type ReactNode, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { usePluginContributions } from "@/src/hooks/usePluginContributions.ts";
import {
	type ProjectDockTab,
	useProjectDockStore,
} from "@/src/store/useProjectDockStore.ts";
import { useWorkspaceStore } from "@/src/store/useWorkspaceStore.ts";
import {
	ProjectDockSlotsProvider,
	useProjectDockSlots,
} from "./project-dock-context.tsx";
import { ProjectDockTabContent } from "./WorkspacePanels.tsx";

/** Stable empty list so Zustand's getSnapshot keeps identity when a folder has
 *  no dock tabs (or no folder is open) — a fresh `[]` every call loops forever. */
const EMPTY_PROJECT_DOCK_TABS: ProjectDockTab[] = [];

export function ProjectDockHost({ children }: { children: ReactNode }) {
	return (
		<ProjectDockSlotsProvider>
			{children}
			<ProjectDockPortals />
		</ProjectDockSlotsProvider>
	);
}

function ProjectDockPortals() {
	const folder = useWorkspaceStore((s) => s.folder);
	const tabs = useProjectDockStore((s) =>
		folder
			? (s.byFolder[folder] ?? EMPTY_PROJECT_DOCK_TABS)
			: EMPTY_PROJECT_DOCK_TABS
	);
	const { dock_panels: dockPanels } = usePluginContributions();
	const { getSlot, slotEpoch } = useProjectDockSlots();

	// slotEpoch is read so we re-render when a chat registers/unregisters a slot.
	void slotEpoch;

	return (
		<>
			{tabs.map((tab) => (
				<HostedProjectTab
					dockPanels={dockPanels}
					folder={folder}
					key={tab.uid}
					slot={getSlot(tab.uid)}
					tab={tab}
				/>
			))}
		</>
	);
}

function HostedProjectTab({
	tab,
	folder,
	slot,
	dockPanels,
}: {
	dockPanels: Parameters<typeof ProjectDockTabContent>[0]["dockPanels"];
	folder: string | null;
	slot: HTMLElement | null;
	tab: ProjectDockTab;
}) {
	const [fallbackEl, setFallbackEl] = useState<HTMLDivElement | null>(null);
	const setFallbackRef = useCallback((element: HTMLDivElement | null) => {
		setFallbackEl((previous) => (previous === element ? previous : element));
	}, []);
	const target = slot ?? fallbackEl;

	const content = (
		<ProjectDockTabContent
			active={slot !== null}
			dockPanels={dockPanels}
			folder={folder}
			tab={tab}
		/>
	);

	return (
		<>
			<div aria-hidden hidden ref={setFallbackRef} />
			{target ? createPortal(content, target) : null}
		</>
	);
}
