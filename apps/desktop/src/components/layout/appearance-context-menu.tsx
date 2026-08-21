import {
	ContextMenuCheckboxItem,
	ContextMenuSeparator,
} from "@ryu/ui/components/context-menu.tsx";
import type { ReactNode } from "react";
import type { AgentRowStyle } from "@/src/hooks/useAgentRowStyle.ts";

/** Persisted key for the sidebar's searchable overflow presentation. */
export const SIDEBAR_OVERFLOW_POPOVER_KEY = "ryu:sidebar-overflow-popover";

export function ContextMenuSectionHeading({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
			{children}
		</div>
	);
}

export function TabBarAppearanceMenuItems({
	floatingTabs,
	setFloatingTabs,
	setTabDropdownEnabled,
	setTabSearchButtonVisible,
	tabDropdownEnabled,
	tabSearchButtonVisible,
}: {
	floatingTabs: boolean;
	setFloatingTabs: (value: boolean) => void;
	setTabDropdownEnabled: (value: boolean) => void;
	setTabSearchButtonVisible: (value: boolean) => void;
	tabDropdownEnabled: boolean;
	tabSearchButtonVisible: boolean;
}) {
	return (
		<>
			<ContextMenuSeparator />
			<ContextMenuCheckboxItem
				checked={tabDropdownEnabled}
				onCheckedChange={setTabDropdownEnabled}
			>
				Show tabs as a dropdown
			</ContextMenuCheckboxItem>
			<ContextMenuCheckboxItem
				checked={tabSearchButtonVisible}
				disabled={tabDropdownEnabled}
				onCheckedChange={setTabSearchButtonVisible}
			>
				Show tab search button
			</ContextMenuCheckboxItem>
			<ContextMenuCheckboxItem
				checked={floatingTabs}
				onCheckedChange={setFloatingTabs}
			>
				Floating tab pills
			</ContextMenuCheckboxItem>
		</>
	);
}

export function SidebarListAppearanceMenuItems({
	activeModeKey,
	agentRowStyle,
	groupByDate,
	groupedNav,
	setAgentRowStyle,
	setGroupByDate,
	setGroupedNav,
	setShowSidebarChatPreview,
	setSidebarOverflowPopover,
	showSidebarChatPreview,
	sidebarOverflowPopover,
}: {
	activeModeKey: string;
	agentRowStyle: AgentRowStyle;
	groupByDate: boolean;
	groupedNav: boolean;
	setAgentRowStyle: (style: AgentRowStyle) => void;
	setGroupByDate: (value: boolean) => void;
	setGroupedNav: (value: boolean) => void;
	setShowSidebarChatPreview: (value: boolean) => void;
	setSidebarOverflowPopover: (value: boolean) => void;
	showSidebarChatPreview: boolean;
	sidebarOverflowPopover: boolean;
}) {
	return (
		<>
			<ContextMenuSectionHeading>List presentation</ContextMenuSectionHeading>
			<ContextMenuCheckboxItem
				checked={groupByDate}
				onCheckedChange={setGroupByDate}
			>
				Group lists by date
			</ContextMenuCheckboxItem>
			<ContextMenuCheckboxItem
				checked={groupedNav}
				onCheckedChange={setGroupedNav}
			>
				Projects & Spaces as pickers
			</ContextMenuCheckboxItem>
			<ContextMenuCheckboxItem
				checked={showSidebarChatPreview}
				onCheckedChange={setShowSidebarChatPreview}
			>
				Show latest message / tool state
			</ContextMenuCheckboxItem>
			<ContextMenuCheckboxItem
				checked={sidebarOverflowPopover}
				onCheckedChange={setSidebarOverflowPopover}
			>
				Search section overflow in a popover
			</ContextMenuCheckboxItem>
			<ContextMenuCheckboxItem
				checked={agentRowStyle === "messaging"}
				disabled={activeModeKey === "agent"}
				onCheckedChange={(checked) =>
					setAgentRowStyle(checked ? "messaging" : "compact")
				}
			>
				Messaging-style agent rows
			</ContextMenuCheckboxItem>
		</>
	);
}
