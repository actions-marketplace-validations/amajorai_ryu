import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
} from "@ryu/ui/components/context-menu.tsx";
import { createRoot } from "react-dom/client";
import {
	SIDEBAR_OVERFLOW_POPOVER_KEY,
	SidebarListAppearanceMenuItems,
	TabBarAppearanceMenuItems,
	TabLayoutMenuItems,
} from "../../src/components/layout/appearance-context-menu.tsx";
import {
	setAgentRowStyle,
	useAgentRowStylePref,
} from "../../src/hooks/useAgentRowStyle.ts";
import { useChatDateGrouping } from "../../src/hooks/useChatDateGrouping.ts";
import { useFloatingTabs } from "../../src/hooks/useFloatingTabs.ts";
import { usePersistedToggle } from "../../src/hooks/usePersistedToggle.ts";
import { useSidebarChatPreview } from "../../src/hooks/useSidebarChatPreview.ts";
import { useSidebarGroupedNav } from "../../src/hooks/useSidebarGroupedNav.ts";
import { useTabDropdown } from "../../src/hooks/useTabDropdown.ts";
import { setTabLayout, useTabLayout } from "../../src/hooks/useTabLayout.ts";
import { useTabSearchButton } from "../../src/hooks/useTabSearchButton.ts";
import "../../src/index.css";

const PROOF_RESET_KEY = "ryu:appearance-context-menu-proof-reset";
if (sessionStorage.getItem(PROOF_RESET_KEY) !== "true") {
	localStorage.removeItem("ryu:tab-dropdown");
	localStorage.removeItem("ryu:tab-search-button");
	localStorage.removeItem("ryu:floating-tabs");
	localStorage.removeItem("ryu_tab_layout");
	localStorage.removeItem("ryu:chat-date-grouping");
	localStorage.removeItem("ryu:sidebar-grouped-nav");
	localStorage.removeItem("ryu:sidebar-chat-preview");
	localStorage.removeItem(SIDEBAR_OVERFLOW_POPOVER_KEY);
	localStorage.removeItem("ryu:agent-row-style");
	sessionStorage.setItem(PROOF_RESET_KEY, "true");
}

function Story() {
	const [tabDropdownEnabled, setTabDropdownEnabled] = useTabDropdown();
	const [tabSearchButtonVisible, setTabSearchButtonVisible] =
		useTabSearchButton();
	const tabLayout = useTabLayout();
	const [floatingTabs, setFloatingTabs] = useFloatingTabs();
	const [groupByDate, setGroupByDate] = useChatDateGrouping();
	const [groupedNav, setGroupedNav] = useSidebarGroupedNav();
	const [showSidebarChatPreview, setShowSidebarChatPreview] =
		useSidebarChatPreview();
	const [sidebarOverflowPopover, setSidebarOverflowPopover] =
		usePersistedToggle(SIDEBAR_OVERFLOW_POPOVER_KEY, false);
	const agentRowStyle = useAgentRowStylePref();

	return (
		<main className="min-h-screen bg-background p-8 text-foreground">
			<div className="mx-auto max-w-4xl space-y-6">
				<header>
					<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
						Appearance proof
					</p>
					<h1 className="mt-1 font-semibold text-3xl">
						Right-click settings in context
					</h1>
					<p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-6">
						The same persisted Appearance preferences are available beside the
						chrome they change.
					</p>
				</header>

				<div className="grid gap-4 md:grid-cols-2">
					<ContextMenu>
						<ContextMenuTrigger
							render={
								<button
									className="min-h-44 w-full rounded-2xl border border-border/70 bg-card p-5 text-left shadow-sm transition-colors hover:bg-muted/40"
									data-testid="sidebar-surface"
									type="button"
								>
									<span className="font-semibold text-sm">Sidebar surface</span>
									<span className="mt-2 block text-muted-foreground text-xs">
										Right-click for list presentation controls
									</span>
								</button>
							}
						/>
						<ContextMenuContent>
							<SidebarListAppearanceMenuItems
								activeModeKey="sections"
								agentRowStyle={agentRowStyle}
								groupByDate={groupByDate}
								groupedNav={groupedNav}
								setAgentRowStyle={setAgentRowStyle}
								setGroupByDate={setGroupByDate}
								setGroupedNav={setGroupedNav}
								setShowSidebarChatPreview={setShowSidebarChatPreview}
								setSidebarOverflowPopover={setSidebarOverflowPopover}
								showSidebarChatPreview={showSidebarChatPreview}
								sidebarOverflowPopover={sidebarOverflowPopover}
							/>
							<TabLayoutMenuItems onChange={setTabLayout} value={tabLayout} />
						</ContextMenuContent>
					</ContextMenu>

					<ContextMenu>
						<ContextMenuTrigger
							render={
								<button
									className="min-h-44 w-full rounded-2xl border border-border/70 bg-card p-5 text-left shadow-sm transition-colors hover:bg-muted/40"
									data-testid="tab-surface"
									type="button"
								>
									<span className="font-semibold text-sm">
										Title-bar tab surface
									</span>
									<span className="mt-2 block text-muted-foreground text-xs">
										Right-click for tab presentation controls
									</span>
								</button>
							}
						/>
						<ContextMenuContent>
							<TabBarAppearanceMenuItems
								floatingTabs={floatingTabs}
								setFloatingTabs={setFloatingTabs}
								setTabDropdownEnabled={setTabDropdownEnabled}
								setTabSearchButtonVisible={setTabSearchButtonVisible}
								tabDropdownEnabled={tabDropdownEnabled}
								tabSearchButtonVisible={tabSearchButtonVisible}
							/>
							<TabLayoutMenuItems onChange={setTabLayout} value={tabLayout} />
						</ContextMenuContent>
					</ContextMenu>
				</div>

				<div className="grid gap-3 rounded-2xl border border-border/70 bg-card p-5 text-sm md:grid-cols-2">
					<p data-testid="sidebar-state">
						Sidebar: {groupByDate ? "date grouped" : "flat lists"} ·{" "}
						{showSidebarChatPreview ? "previews on" : "previews off"}
					</p>
					<p data-testid="tab-state">
						Tabs: {tabDropdownEnabled ? "dropdown" : "full strip"} ·{" "}
						{tabSearchButtonVisible ? "search shown" : "search hidden"}
					</p>
					<p data-testid="tab-layout-state">Layout: {tabLayout}</p>
				</div>
			</div>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
