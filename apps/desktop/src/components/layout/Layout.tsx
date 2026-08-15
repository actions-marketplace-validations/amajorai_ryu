import {
	ArrowLeft01Icon,
	ArrowRight01Icon,
	Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { HotkeysProvider, useHotkey } from "@ryu/hotkeys/react";
import { Button } from "@ryu/ui/components/button.tsx";
import {
	SidebarInset,
	SidebarProvider,
	useSidebar,
} from "@ryu/ui/components/sidebar.tsx";
import { toast } from "@ryu/ui/components/sileo";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@ryu/ui/components/tooltip.tsx";
import { useIsMobile } from "@ryu/ui/hooks/use-mobile.ts";
import {
	clampWithRubberband,
	createVelocityTracker,
	projectEndpoint,
} from "@ryu/ui/lib/gesture.ts";
import { haptic } from "@ryu/ui/lib/haptics.ts";
import { cn } from "@ryu/ui/lib/utils.ts";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatDisplayPrefs } from "@/src/components/chat/ChatDisplayPrefsProvider.tsx";
import { DeepLinkController } from "@/src/components/deeplink/DeepLinkController.tsx";
import { EmptyTabsState } from "@/src/components/layout/EmptyTabsState.tsx";
import { DesktopReportHost } from "@/src/components/marketplace/report-host.tsx";
import { ProjectDockHost } from "@/src/components/panels/ProjectDockHost.tsx";
import { PrivacyDisclosure } from "@/src/components/settings/privacy-disclosure.tsx";
import { SupportAccessBanner } from "@/src/components/settings/support-access-banner.tsx";
import { SafeModeBanner } from "@/src/components/shell/SafeModeBanner.tsx";
import { AutoUpdater } from "@/src/components/updater/AutoUpdater.tsx";
import {
	ChatHistoryProvider,
	useChatHistoryContext,
} from "@/src/contexts/ChatHistoryContext.tsx";
import { SpacesProvider } from "@/src/contexts/SpacesContext.tsx";
import { SystemStatusProvider } from "@/src/contexts/SystemStatusContext.tsx";
import type { InitialTab, Tab } from "@/src/contexts/TabsContext.tsx";
import {
	CurrentTabIdProvider,
	findSplit,
	IsActiveTabProvider,
	splitPaneTabs,
	TabsProvider,
	useTabsContext,
} from "@/src/contexts/TabsContext.tsx";
import {
	TitleBarProvider,
	useTitleBarContext,
} from "@/src/contexts/TitleBarContext.tsx";
import {
	useAppShellPath,
	useAppShellRoutes,
} from "@/src/contributions/app-shell-routes.ts";
import { seedBuiltinRoutes } from "@/src/contributions/builtins.ts";
import { RouteOutlet } from "@/src/contributions/RouteOutlet.tsx";
import { useCompanionAlias } from "@/src/contributions/use-companion-alias.ts";
import { useApprovalEvents } from "@/src/hooks/useApprovalEvents.ts";
import { usePluginThemeSync } from "@/src/hooks/useContributedThemes.ts";
import { useDesktopNotificationsStream } from "@/src/hooks/useDesktopNotificationsStream.ts";
import { useDownloadsStream } from "@/src/hooks/useDownloadsStream.ts";
import { useEditorUploader } from "@/src/hooks/useEditorUploader.ts";
import { useMeetingStream } from "@/src/hooks/useMeetingStream.ts";
import { useMonitorAlertsStream } from "@/src/hooks/useMonitorAlertsStream.ts";
import { useNotificationEvents } from "@/src/hooks/useNotificationEvents.ts";
import {
	usePluginContributionRoutes,
	usePluginContributionsLiveRefresh,
	usePluginContributionTabIcons,
} from "@/src/hooks/usePluginContributions.ts";
import { useQuestEvents } from "@/src/hooks/useQuestEvents.ts";
import { useRegisterEditorAi } from "@/src/hooks/useRegisterEditorAi.ts";
import { useSidebarVariant } from "@/src/hooks/useSidebarVariant.ts";
import { useTabLayout } from "@/src/hooks/useTabLayout.ts";
import {
	DEFAULT_SIDEBAR_WIDTH,
	MAX_SIDEBAR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	SIDEBAR_WIDTH_KEY,
} from "@/src/hooks/useThemePreset.ts";
import { useTitleBarClearsContent } from "@/src/hooks/useTitleBarClearsContent.ts";
import { setCrashRoute } from "@/src/lib/crash-context.ts";
import {
	DASHBOARDS_HOME_BUTTON_ID,
	DASHBOARDS_PLUGIN_ID,
} from "@/src/lib/dashboards/app.ts";
import { toggleFullscreen } from "@/src/lib/fullscreen.ts";
import { DESKTOP_HOTKEYS } from "@/src/lib/hotkeys/actions.ts";
import { coreKvHotkeyStorage } from "@/src/lib/hotkeys/storage.ts";
import { useAssistantStore } from "@/src/store/useAssistantStore.ts";
import { useChatHotkeyTargets } from "@/src/store/useChatHotkeyTargets.ts";
import { useSettingsDialog } from "@/src/store/useSettingsDialog.ts";
import { useWorkspaceStore } from "@/src/store/useWorkspaceStore.ts";
import { AssistantDock } from "../assistant/AssistantDock.tsx";
import { AssistantPanel } from "../assistant/AssistantPanel.tsx";
import {
	IconSidebarClosed,
	IconSidebarOpen,
} from "../icons/SidebarToggleIcon.tsx";
import { AppSidebar, SidebarPanelContent } from "./AppSidebar.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { SplitDropZones } from "./SplitDropZones.tsx";
import { SaveSplitPresetDialog } from "./SplitPresetMenu.tsx";
import {
	computeSplitLayout,
	paneNeedsTopClearance,
	paneRectStyle,
	SplitGutters,
} from "./SplitView.tsx";
import { TabGlyph, TitleBar, useTabBusy } from "./TitleBar.tsx";
import { TabDndProvider } from "./tabDnd.tsx";
import { pathScrollsUnderTitlebar } from "./titlebarScroll.ts";

// Populate the contribution registry with every built-in route BEFORE first
// render, so `RouteOutlet` (which resolves a tab's path through the registry)
// can render built-in tabs. Idempotent — safe to call at module load.
seedBuiltinRoutes();

const isMac = navigator.userAgent.includes("Mac");

/** Docked-sidebar resize bounds. */
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
/**
 * Collapse the sidebar when the rail drag was HEADED below this width, even if
 * the pointer lifted before reaching it. Sits under the minimum so only a
 * deliberate inward gesture — a real flick, or a drag that already fought the
 * rubber-band past the min — can trigger it.
 */
const SIDEBAR_COLLAPSE_PROJECTION = 140;

// Floating chrome at the bottom-left of each split pane: a title pill (always
// visible; fades only when the pointer is near it so content behind stays
// reachable) plus, on the focused pane, the page actions which never fade.
function PaneBadge({
	actions,
	activeSplit,
	containerRef,
	focused,
	tab,
}: {
	actions?: ReactNode;
	activeSplit: boolean;
	containerRef: React.RefObject<HTMLElement | null>;
	focused: boolean;
	tab: Tab;
}) {
	const pillRef = useRef<HTMLDivElement>(null);
	const [pillOpacity, setPillOpacity] = useState(1);
	const busy = useTabBusy(tab);

	// biome-ignore lint/correctness/useExhaustiveDependencies: containerRef is stable
	useEffect(() => {
		if (!activeSplit) {
			return;
		}
		const container = containerRef.current;
		if (!container) {
			return;
		}

		const FADE_RADIUS = 120;

		const onMove = (e: PointerEvent) => {
			const pill = pillRef.current;
			if (!pill) {
				return;
			}
			const rect = pill.getBoundingClientRect();
			const cx = rect.left + rect.width / 2;
			const cy = rect.top + rect.height / 2;
			const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
			// Far = fully opaque; near the pill = transparent so content behind is
			// clickable. Actions sit beside the pill and are not part of this fade.
			setPillOpacity(Math.min(1, dist / FADE_RADIUS));
		};

		const onLeave = () => setPillOpacity(1);

		container.addEventListener("pointermove", onMove);
		container.addEventListener("pointerleave", onLeave);
		return () => {
			container.removeEventListener("pointermove", onMove);
			container.removeEventListener("pointerleave", onLeave);
		};
	}, [activeSplit, containerRef]);

	if (!activeSplit) {
		return null;
	}

	return (
		// Fixed row height (h-8, the action buttons' size) so the pill sits at the
		// same spot whether or not the focused pane's actions are beside it —
		// otherwise the row collapses to the pill's own height on unfocused panes
		// and the badge visibly jumps/resizes every time focus moves.
		<div className="pointer-events-none absolute bottom-2 left-2 z-10 flex h-8 items-center gap-1.5">
			<div
				className={cn(
					"flex h-6 items-center gap-1.5 rounded-full px-2.5 backdrop-blur-sm transition-opacity duration-300",
					focused
						? "bg-primary text-primary-foreground"
						: "bg-muted/70 text-muted-foreground ring-1 ring-border/20"
				)}
				ref={pillRef}
				style={{ opacity: pillOpacity }}
			>
				<TabGlyph
					busy={busy}
					className={cn(
						"size-3 shrink-0",
						focused ? "text-primary-foreground" : "text-muted-foreground"
					)}
					logoSize="12px"
					path={tab.path}
					unloaded={tab.unloaded}
				/>
				{busy && !tab.unloaded ? (
					<span className="an-text-shimmer an-text-shimmer--active max-w-32 truncate font-medium text-xs [animation-duration:2s]">
						{tab.title}
					</span>
				) : (
					<span className="max-w-32 truncate font-medium text-xs">
						{tab.title}
					</span>
				)}
			</div>
			{focused && actions ? (
				<div
					className="pointer-events-auto flex h-8 shrink-0 flex-row items-center gap-1 rounded-2xl bg-background/80 px-1 shadow-lg ring-1 ring-border/40 backdrop-blur-sm"
					data-tauri-drag-region={false}
				>
					{actions}
				</div>
			) : null}
		</div>
	);
}

interface LayoutContentProps {
	onSidebarWidthChange: (w: number) => void;
	sidebarWidth: number;
}

function LayoutContent({
	sidebarWidth,
	onSidebarWidthChange,
}: LayoutContentProps) {
	const {
		activeConversationId,
		setActiveConversationId,
		deleteConversation,
		createConversation,
	} = useChatHistoryContext();

	// One app-wide subscription to Core's download SSE stream → downloads store,
	// powering the global DownloadCenter overlay below.
	useDownloadsStream();

	// One app-wide subscription to Core's monitor-alert SSE stream → in-app toast
	// + native OS notification when a watched site changes.
	useMonitorAlertsStream();

	// App-wide subscription to Core's meeting-event SSE stream → auto-detection
	// toast + live transcript/notes refresh on the Meetings page.
	useMeetingStream();

	// App-wide subscription to Core's quest-event SSE stream → "looks done?"
	// suggestion toast + auto-completion announcements + live quest refresh.
	useQuestEvents();

	// App-wide subscription to Core's approval-inbox SSE stream → "approval
	// needed" toast + OS notification + live approvals refresh.
	useApprovalEvents();

	// App-wide subscription to Core's desktop-notification SSE stream → in-app
	// toast + native OS notification from built-in agent actions (notify__desktop).
	useDesktopNotificationsStream();

	// App-wide subscription to Core's per-user notification SSE stream → toast +
	// OS notification for user-targeted pings (notify_user workflow node) and a
	// live Inbox feed. Distinct from the broadcast stream above (Core filters
	// user-targeted pings out of /api/events/all), so the two never double-toast.
	useNotificationEvents();

	// Point the Plate editor's media uploads at Core's local media store.
	useEditorUploader();

	// Register the editor's inline-AI model (routed via the Gateway) from prefs.
	useRegisterEditorAi();

	// Register a navigable /plugin/<id> route for each enabled plugin companion
	// (and tear it down when the plugin is disabled) into the same contribution
	// registry the built-ins seed, so RouteOutlet renders it. Called once here
	// because LayoutContent is always mounted; a disabled plugin's route then
	// resolves to null (blank) — the "route disappears" behavior of #446.
	usePluginContributionRoutes();
	// Same seam for the shell pages an APP owns (the Home dashboard): the route is
	// minted at the path the app's manifest declares, and disappears with the app.
	useAppShellRoutes();
	usePluginContributionTabIcons();

	// Live refresh for the contributions cache: Core broadcasts on the
	// `system:plugins` realtime room after every plugin enable/disable/grants
	// change; this invalidates the shared react-query read immediately. Remote
	// nodes fail-soft to the stale-window poll above.
	usePluginContributionsLiveRefresh();

	// Mirror marketplace-installed themes (`contributes.themes`) into the local
	// resolution cache the theme picker and `initTheme()` read. Mounted here, not in
	// Appearance settings: a theme must resolve at boot and survive the user never
	// opening settings at all.
	usePluginThemeSync();

	const { open, openMobile, setOpen, toggleSidebar } = useSidebar();
	// The desktop app is also served as a web app, so it has to survive phone
	// widths. `isMobile` (<768px) is the single layout-mode switch: the sidebar
	// stops being dockable and becomes the primitive's Sheet, and everything
	// that needs a second column beside the content (assistant rail, split
	// panes, hover-peek) stands down. It is a *width* test, not a Tauri test —
	// native window chrome (traffic lights, drag regions) still keys off
	// `isMac`. The two never collide because the Tauri window's minWidth is
	// 800px, so `isMobile` only ever fires in a browser.
	const isMobile = useIsMobile();
	// On mobile the sidebar is a Sheet, so its open state is `openMobile`.
	const sidebarShown = isMobile ? openMobile : open;
	// Reserve room on the right when the "Ask Ryu" assistant is docked as a
	// sidebar, so the page content slides in beside it rather than under it.
	const assistantMode = useAssistantStore((s) => s.mode);
	const [sidebarVariant] = useSidebarVariant();
	// Floating dock is inset 8px from the right edge (380 + 8); inset mode is a
	// flush rail so only the panel width is reserved.
	const assistantDockReserve =
		assistantMode === "sidebar" && !isMobile
			? sidebarVariant === "floating"
				? 388
				: 380
			: undefined;
	const {
		tabs,
		splits,
		activeTabId,
		openTab,
		closeTab,
		focusTab,
		goBack,
		goForward,
		canGoBack,
		canGoForward,
	} = useTabsContext();
	const { actions: titleBarActions } = useTitleBarContext();
	const tabLayout = useTabLayout();
	// Auto-hide frees the top clearance so content fills the window; the bar
	// overlays on hover. Mobile never auto-hides (see TitleBar). Fullscreen forces
	// the same treatment without touching the saved pref. Shared hook keeps this
	// in lockstep with `effectiveAutoHide` in TitleBar — or the bar slides away
	// while the row it occupied stays reserved (a blank strip on screen).
	const titleBarClearsContent = useTitleBarClearsContent();
	const [floatOpen, setFloatOpen] = useState(false);
	const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	// The positioned content area; SplitGutters measures it to translate drag
	// pixels into pane fractions.
	const contentRef = useRef<HTMLDivElement>(null);

	// In vertical-tabs mode the open tabs live in the sidebar, so the strip is
	// hidden. Reveal the docked sidebar the moment the user switches TO vertical
	// (only on that transition, so they can still close it afterward) — otherwise
	// toggling the mode with a closed sidebar would make the tabs seem to vanish.
	const prevLayoutRef = useRef(tabLayout);
	useEffect(() => {
		if (prevLayoutRef.current !== "vertical" && tabLayout === "vertical") {
			setOpen(true);
		}
		prevLayoutRef.current = tabLayout;
	}, [tabLayout, setOpen]);

	// The split (if any) the focused tab belongs to, its computed pane/gutter
	// geometry, and the ids of the panes to show (in the tree's pane order).
	// With no split, only the focused tab is shown — exactly as before. Every
	// other tab stays mounted but hidden so its state survives.
	// Splits need two readable columns side by side, which a phone width has no
	// room for, so the focused tab takes the whole pane area and every split
	// member stays mounted-but-hidden. The split tree itself is untouched —
	// widening the viewport brings the layout straight back.
	const activeSplit = isMobile ? null : findSplit(tabs, splits, activeTabId);
	const splitLayout = activeSplit ? computeSplitLayout(activeSplit.root) : null;
	let paneIds: string[] = [];
	if (activeSplit) {
		paneIds = splitPaneTabs(tabs, activeSplit).map((t) => t.id);
	} else if (activeTabId) {
		paneIds = [activeTabId];
	}

	// Record the focused tab's route for the crash screen's "Copy console" action.
	// CrashBoundary is outside the tabs context, so it reads this via the
	// crash-context singleton (see apps/desktop/src/lib/crash-context.ts).
	const activeTab = tabs.find((t) => t.id === activeTabId);
	useEffect(() => {
		setCrashRoute(
			activeTab ? { path: activeTab.path, title: activeTab.title } : null
		);
		// The two fields, not the tab object: `tabs.find(...)` churns whenever the
		// tabs array is rebuilt, which would re-stamp the crash route on every
		// unrelated tab-state change.
	}, [activeTab?.path, activeTab?.title]);

	// The floating "Ask Ryu" dock would just overlap a full chat surface, so hide
	// it whenever a `/chat` pane is currently visible (in a split, any visible
	// pane being chat is enough for the overlap). Chat pages already *are* the
	// assistant, so the dock is redundant there.
	const chatPaneVisible = paneIds.some(
		(id) => tabs.find((t) => t.id === id)?.path.startsWith("/chat") ?? false
	);

	// Floating Ryu (Ask Ryu dock) launcher, restored. Hidden only when a chat pane
	// is already visible (that pane IS the assistant, so the dock is redundant
	// there — see `chatPaneVisible` above).
	const showAssistantDock = true;

	const resizingRef = useRef(false);
	const startXRef = useRef(0);
	const startWidthRef = useRef(sidebarWidth);
	const widthRef = useRef(sidebarWidth);
	const pointerIdRef = useRef<number | null>(null);
	// Position history for the release velocity — see `endRailDrag`.
	const railVelocityRef = useRef(createVelocityTracker());

	// POINTER events, not mouse events. The rail used to listen for
	// `mousemove`/`mouseup`, which a pen or a touch drag never fires — the
	// sidebar simply could not be resized by either. `setPointerCapture` then
	// keeps the drag alive when the pointer leaves the 2px handle, which is what
	// the document-level listener was standing in for.
	const handleRailPointerDown = useCallback(
		(e: React.PointerEvent) => {
			e.preventDefault();
			e.stopPropagation();
			// Capture on the handle: every subsequent move/up for this pointer is
			// retargeted here and still bubbles to the document listeners below.
			e.currentTarget.setPointerCapture?.(e.pointerId);
			pointerIdRef.current = e.pointerId;
			resizingRef.current = true;
			startXRef.current = e.clientX;
			startWidthRef.current = sidebarWidth;
			widthRef.current = sidebarWidth;
			railVelocityRef.current.reset();
			railVelocityRef.current.sample(e.clientX, e.timeStamp);
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
		},
		[sidebarWidth]
	);

	useEffect(() => {
		const finishDrag = () => {
			resizingRef.current = false;
			pointerIdRef.current = null;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};

		const onMove = (e: PointerEvent) => {
			if (!resizingRef.current || e.pointerId !== pointerIdRef.current) {
				return;
			}
			railVelocityRef.current.sample(e.clientX, e.timeStamp);
			const raw = startWidthRef.current + (e.clientX - startXRef.current);
			// Give at the limits instead of stopping dead. The overshoot is
			// transient — `endRailDrag` snaps back to the hard bounds on release,
			// so nothing out of range is ever the resting value.
			const next = clampWithRubberband(
				raw,
				SIDEBAR_MIN_WIDTH,
				SIDEBAR_MAX_WIDTH,
				window.innerWidth
			);
			widthRef.current = next;
			onSidebarWidthChange(next);
		};

		const onUp = (e: PointerEvent) => {
			if (!resizingRef.current || e.pointerId !== pointerIdRef.current) {
				return;
			}
			railVelocityRef.current.sample(e.clientX, e.timeStamp);
			// Where the gesture was HEADED, not where the pointer happened to stop.
			// A decisive inward flick collapses the sidebar even if the finger
			// lifted well short of the edge; a slow drag to the same pixel does
			// not. Without this the release velocity is simply discarded and both
			// gestures produce the same result.
			const projected = projectEndpoint(
				widthRef.current,
				railVelocityRef.current.velocity()
			);
			finishDrag();
			if (projected < SIDEBAR_COLLAPSE_PROJECTION) {
				// Restore the pre-drag width so reopening does not come back pinned
				// to the minimum.
				onSidebarWidthChange(startWidthRef.current);
				// Same frame as the collapse, not after it — the feedback has to
				// coincide with the event that caused it to read as one thing.
				haptic("snap");
				setOpen(false);
				return;
			}
			onSidebarWidthChange(
				Math.max(
					SIDEBAR_MIN_WIDTH,
					Math.min(SIDEBAR_MAX_WIDTH, widthRef.current)
				)
			);
		};

		// A cancelled pointer (OS gesture, focus loss) never sends `pointerup`;
		// without this the body keeps `col-resize` and `user-select: none`.
		const onCancel = (e: PointerEvent) => {
			if (e.pointerId !== pointerIdRef.current) {
				return;
			}
			finishDrag();
			onSidebarWidthChange(
				Math.max(
					SIDEBAR_MIN_WIDTH,
					Math.min(SIDEBAR_MAX_WIDTH, widthRef.current)
				)
			);
		};

		document.addEventListener("pointermove", onMove, { passive: true });
		document.addEventListener("pointerup", onUp);
		document.addEventListener("pointercancel", onCancel);
		return () => {
			document.removeEventListener("pointermove", onMove);
			document.removeEventListener("pointerup", onUp);
			document.removeEventListener("pointercancel", onCancel);
		};
	}, [onSidebarWidthChange, setOpen]);

	// Close floating sidebar when the docked one opens
	useEffect(() => {
		if (open) {
			if (hideTimer.current) {
				clearTimeout(hideTimer.current);
			}
			setFloatOpen(false);
		}
	}, [open]);

	const showFloat = () => {
		if (hideTimer.current) {
			clearTimeout(hideTimer.current);
			hideTimer.current = null;
		}
		setFloatOpen(true);
	};

	const scheduleHide = () => {
		// Dragging the floating panel's resize handle pulls the cursor out of the
		// panel, firing onMouseLeave. Don't hide while a resize is in progress —
		// otherwise the panel slides away mid-drag.
		if (resizingRef.current) {
			return;
		}
		if (hideTimer.current) {
			clearTimeout(hideTimer.current);
		}
		hideTimer.current = setTimeout(() => {
			// The footer trays (Downloads, Inbox) are portaled to the body — they
			// are wider than the sidebar, and this panel clips them — so moving the
			// pointer onto an open tray reads as leaving the panel. Hold the panel
			// up while one is open and re-check, so it slides away on the tick after
			// the tray closes instead of vanishing out from under it.
			if (document.querySelector('[data-sidebar-overlay="open"]')) {
				scheduleHide();
				return;
			}
			setFloatOpen(false);
		}, 200);
	};

	const handleNewConversation = () => {
		const id = `conv-${Date.now()}`;
		// Born under whatever project is open, so the sidebar nests it right away.
		// Read at call time (not subscribed) — this handler is a one-shot action,
		// and the value that matters is the folder as it is when the user asks.
		createConversation(id, {
			folderPath: useWorkspaceStore.getState().folder ?? undefined,
		});
		setActiveConversationId(id);
		openTab("/chat", { forceNew: true, conversationId: id, title: "New chat" });
	};

	const handleSelectConversation = (id: string) => {
		setActiveConversationId(id);
		openTab("/chat", { conversationId: id });
	};

	const handleDeleteConversation = (id: string) => {
		deleteConversation(id);
		if (activeConversationId === id) {
			setActiveConversationId(null);
		}
	};

	// App-level shortcuts whose handlers live here (sidebar, settings, new chat,
	// route jumps). Everything routes through the unified hotkey registry, so all
	// of these are rebindable in Settings → Keyboard Shortcuts.
	const openSettings = useSettingsDialog((s) => s.openSettings);
	useHotkey("sidebar.toggle", toggleSidebar);
	useHotkey("settings.open", () => openSettings());
	useHotkey("chat.new", handleNewConversation);
	// "Go home" opens whatever path the Dashboards app declares — and does nothing
	// when no enabled app claims it, so the shortcut can't land the user on an
	// "App not enabled" card for a feature they never turned on.
	const dashboardPath = useAppShellPath(
		DASHBOARDS_PLUGIN_ID,
		DASHBOARDS_HOME_BUTTON_ID
	);
	useHotkey("nav.home", () => {
		if (dashboardPath) {
			openTab(dashboardPath);
		}
	});
	// Same rule for the Timeline shortcut, which reaches an app-owned path
	// (`/timeline` resolves through the companion-alias catch-all): no enabled app
	// claims it → the shortcut does nothing, rather than opening a dead tab. This is
	// the AFFORDANCE tier `use-companion-alias.ts` describes.
	const timelineCompanion = useCompanionAlias("/timeline");
	useHotkey("nav.timeline", () => {
		if (timelineCompanion) {
			openTab("/timeline");
		}
	});
	useHotkey("nav.library", () => openTab("/library"));
	// Chat-owned shortcuts, bound ONCE here and dispatched to whichever chat tab
	// is focused. They cannot be registered inside ChatPage: every chat tab stays
	// mounted, and the registry keeps one handler per id (last-writer-wins), so a
	// hidden tab would end up owning Stop and abort the wrong stream. The focused
	// tab publishes its live handlers into `useChatHotkeyTargets`; reading them
	// through `getState()` inside the handler keeps this component from
	// re-rendering on every status change.
	useHotkey("chat.stop", () => {
		const { isStreaming, stop } = useChatHotkeyTargets.getState();
		// No-op unless the focused chat actually has a turn in flight, so the key
		// never interrupts something the user cannot see.
		if (isStreaming) {
			stop?.();
		}
	});
	useHotkey("chat.voice-mode", () => {
		useChatHotkeyTargets.getState().startVoiceMode?.();
	});
	// The docks are ChatPage-local state, so they arrive through the same slot as
	// Stop. A no-op when the focused surface is not a chat, which is correct: the
	// panels only exist there.
	useHotkey("chat.toggle-bottom-panel", () => {
		useChatHotkeyTargets.getState().toggleBottomPanel?.();
	});
	useHotkey("chat.toggle-right-panel", () => {
		useChatHotkeyTargets.getState().toggleRightPanel?.();
	});
	// The floating Ryu chat. `open("floating")` explicitly, never the bare
	// `open()`: that restores the LAST layout, and when that was `sidebar` the
	// AssistantDock renders nothing — the key would look broken.
	useHotkey("assistant.toggle", () => {
		const { mode, open, close } = useAssistantStore.getState();
		if (mode === "closed") {
			open("floating");
		} else {
			close();
		}
	});
	// allowInInput: the default binding (F11) is a bare key, which the dispatcher
	// otherwise suppresses while a field has focus — i.e. most of the time, since
	// the composer holds focus on the main surfaces.
	useHotkey(
		"window.fullscreen-toggle",
		() => {
			toggleFullscreen().catch(() => {
				toast.error("Couldn't toggle full screen in this window.");
			});
		},
		{ allowInInput: true }
	);

	// Where the fixed nav cluster sits: clear of the macOS traffic lights, at
	// the standard 16px inset elsewhere, and tight into the corner on a phone
	// (no native chrome to clear, and every pixel of the strip counts).
	let navClusterPosition = "top-4 left-6";
	if (isMobile) {
		navClusterPosition = "top-2 left-2";
	} else if (isMac) {
		navClusterPosition = "top-4 left-24";
	}

	return (
		<TabDndProvider>
			<CommandPalette />
			{/* One instance for every split menu that offers "Save layout as
			    preset" — a context menu unmounts on click, so it cannot host its
			    own dialog. */}
			<SaveSplitPresetDialog />
			<DeepLinkController />
			<PrivacyDisclosure />
			<SupportAccessBanner />
			{/* Mounted app-wide, not per-page: Safe Mode changes what the whole node
			    loads, and a missing app must be explained wherever the user notices
			    it is missing. */}
			<SafeModeBanner />
			<AppSidebar
				activeConversationId={activeConversationId}
				onDeleteConversation={handleDeleteConversation}
				onNewConversation={handleNewConversation}
				onSelectConversation={handleSelectConversation}
			/>

			{/* Pinned navigation cluster (back / forward / sidebar toggle) at the
			    window's top-left. Fixed so it stays put whether the sidebar is docked
			    or collapsed, and out of the tab strip entirely. On macOS it sits just
			    right of the traffic lights; on Windows it uses the same 16px inset as
			    top-4 so the cluster clears the window edge and lines up with the
			    sidebar card's inner padding. At phone widths there is no native
			    chrome to clear and no room for four buttons, so the cluster hugs the
			    top-left corner and drops to the two that can't be reached any other
			    way: the sidebar (Sheet) toggle and search. Back/forward stay
			    available on the platform's own back gesture and via the hotkeys. */}
			<div
				className={cn(
					"fixed z-[60] flex flex-row items-center gap-1",
					navClusterPosition
				)}
				data-tauri-drag-region={false}
			>
				{!isMobile && (
					<>
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										aria-label="Go back"
										className="size-8"
										disabled={!canGoBack}
										onClick={goBack}
										size="icon"
										variant="ghost"
									>
										<HugeiconsIcon className="size-4" icon={ArrowLeft01Icon} />
									</Button>
								}
							/>
							<TooltipContent>Go back</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										aria-label="Go forward"
										className="size-8"
										disabled={!canGoForward}
										onClick={goForward}
										size="icon"
										variant="ghost"
									>
										<HugeiconsIcon className="size-4" icon={ArrowRight01Icon} />
									</Button>
								}
							/>
							<TooltipContent>Go forward</TooltipContent>
						</Tooltip>
					</>
				)}
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label={
									sidebarShown ? "Close navigation" : "Open navigation"
								}
								className="size-8"
								onClick={toggleSidebar}
								size="icon"
								variant="ghost"
							>
								{sidebarShown ? (
									<IconSidebarOpen className="size-4" />
								) : (
									<IconSidebarClosed className="size-4" />
								)}
							</Button>
						}
					/>
					<TooltipContent>
						{sidebarShown ? "Hide sidebar" : "Show sidebar"}
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label="Search"
								className="size-8"
								onClick={() =>
									window.dispatchEvent(
										new CustomEvent("ryu:open-command-palette")
									)
								}
								size="icon"
								variant="ghost"
							>
								<HugeiconsIcon className="size-4" icon={Search01Icon} />
							</Button>
						}
					/>
					<TooltipContent>Search {isMac ? "⌘K" : "Ctrl K"}</TooltipContent>
				</Tooltip>
			</div>

			{/* Resize handle for the docked sidebar. Pointer-only, and there is no
			    docked sidebar to resize at phone widths. */}
			{open && !isMobile && (
				// biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: sidebar resize handle
				<div
					className="fixed top-0 z-20 h-full w-2 cursor-col-resize opacity-0 transition-opacity hover:bg-sidebar-border hover:opacity-100"
					onPointerDown={handleRailPointerDown}
					// `touch-action: none` is what actually makes this draggable by
					// touch: without it the browser claims the gesture for scrolling
					// before the second pointermove ever reaches us.
					style={{ left: `${sidebarWidth - 4}px`, touchAction: "none" }}
				/>
			)}

			{/* Left-edge hover zone for floating sidebar. Hover-to-peek has no touch
			    equivalent, and a 288px panel pinned over a 375px viewport would just
			    shadow the Sheet that `<AppSidebar>` already renders at this width —
			    so the whole hand-rolled float stands down on mobile. */}
			{!(open || isMobile) && (
				<div
					className="fixed top-0 left-0 z-50 h-full"
					style={{ pointerEvents: "none", width: `${sidebarWidth + 16}px` }}
				>
					<div
						className="ryu-sidebar-surface absolute top-2 bottom-2 left-2 flex flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
						onMouseEnter={showFloat}
						onMouseLeave={scheduleHide}
						style={{
							width: `${sidebarWidth}px`,
							pointerEvents: floatOpen ? "auto" : "none",
							transform: floatOpen
								? "translateX(0)"
								: "translateX(calc(-100% - 12px))",
							opacity: floatOpen ? 1 : 0,
							transition:
								"transform 280ms cubic-bezier(0.34,1.2,0.64,1), opacity 240ms ease-out",
						}}
					>
						<SidebarPanelContent
							activeConversationId={activeConversationId}
							onDeleteConversation={handleDeleteConversation}
							onNewConversation={handleNewConversation}
							onSelectConversation={handleSelectConversation}
						/>
						<div
							className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize opacity-0 transition-opacity hover:bg-sidebar-border hover:opacity-100"
							onPointerDown={handleRailPointerDown}
							style={{ touchAction: "none" }}
						/>
					</div>

					<div
						className="absolute top-0 left-0 h-full w-10"
						onMouseEnter={showFloat}
						onMouseLeave={scheduleHide}
						style={{ pointerEvents: "auto" }}
					/>
				</div>
			)}

			<SidebarInset
				className={cn(
					"relative flex flex-col overflow-hidden transition-[padding] duration-300 ease-out",
					// Inset mode normally keeps mr-2 so the canvas clears the window
					// edge; when the Ask Ryu rail is docked it plays the same role as
					// the left sidebar (ml-0), so drop the right margin and let the
					// canvas abut the flush rail.
					assistantMode === "sidebar" &&
						sidebarVariant === "inset" &&
						!isMobile &&
						"md:mr-0"
				)}
				style={{
					// Reserves room for the docked assistant so page content sits
					// beside it rather than under it. Floating chrome is 380px + 8px
					// right inset; inset chrome is a flush 380px rail. On a phone the
					// panel goes full-width instead of docking, so skip the reservation.
					paddingRight: assistantDockReserve,
				}}
			>
				{/* Tab panels fill the entire inset and scroll UNDER the frosted
				    titlebar (which is absolutely positioned on top). Each page wrapper
				    is padded down by the titlebar height so its own header clears the
				    tab strip while content reads as one continuous glass surface. */}
				<div
					className="relative min-h-0 flex-1 overflow-hidden"
					ref={contentRef}
				>
					{tabs.length === 0 ? (
						<EmptyTabsState />
					) : (
						tabs.map((tab) => {
							// `focused` drives the titlebar and the active-pane highlight; a
							// split also shows non-focused panes, which stay fully live.
							const focused = tab.id === activeTabId;
							const paneRect = splitLayout?.panes.get(tab.id);
							const visible = paneRect
								? true
								: !activeSplit && tab.id === activeTabId;
							// Panes are absolutely positioned so the tree is never reparented
							// (reparenting would unmount it and lose state). Hidden-but-mounted
							// tabs keep their timers/subscriptions; unloaded tabs are dropped
							// entirely. Active split members are exempt from unloading, so a
							// visible pane is never null.
							let style: CSSProperties;
							if (paneRect) {
								style = paneRectStyle(paneRect);
							} else if (visible) {
								style = { position: "absolute", inset: 0 };
							} else {
								style = { display: "none" };
							}
							// Scroll-under panes (chat + the store / marketplace family)
							// manage their own top clearance internally so their content sits
							// UNDER the frosted titlebar. Every other page reserves the bar's
							// height so its header sits cleanly below the solid tab bar.
							const scrollsUnderTitlebar = pathScrollsUnderTitlebar(tab.path);
							const needsClearance =
								titleBarClearsContent &&
								!scrollsUnderTitlebar &&
								(paneRect ? paneNeedsTopClearance(paneRect) : true);
							return (
								<IsActiveTabProvider
									isActive={focused}
									key={`${tab.id}:${tab.navToken ?? 0}`}
								>
									<CurrentTabIdProvider tabId={tab.id}>
										{tab.unloaded ? null : (
											<div
												className={cn(
													"flex flex-col overflow-hidden",
													needsClearance && "pt-12"
												)}
												// Clicking anywhere in a non-focused pane focuses it
												// (no nav-history entry) before the inner UI reacts.
												onMouseDownCapture={
													activeSplit && visible && !focused
														? () => focusTab(tab.id)
														: undefined
												}
												style={style}
											>
												<RouteOutlet
													onClose={() => closeTab(tab.id)}
													tab={tab}
												/>
												<PaneBadge
													actions={focused ? titleBarActions : undefined}
													activeSplit={!!activeSplit && visible}
													containerRef={contentRef}
													focused={focused}
													tab={tab}
												/>
											</div>
										)}
									</CurrentTabIdProvider>
								</IsActiveTabProvider>
							);
						})
					)}
					{activeSplit && (
						<SplitGutters containerRef={contentRef} split={activeSplit} />
					)}
					{/* Warp-style drop zones: while a tab chip/row is dragged, hovering
					    a pane edge previews + creates a split there; the center swaps
					    panes. Renders nothing outside a drag. */}
					{!isMobile && <SplitDropZones containerRef={contentRef} />}
				</div>
				{/* Frosted titlebar overlays the content (absolute, z-10). */}
				<TitleBar />

				{/* Status banners float just below the titlebar so they never push the
				    content down or break the under-the-bar scroll. When the titlebar
				    auto-hides, sit them at the top edge instead. */}
				<div
					className={cn(
						"pointer-events-none absolute right-0 left-0 z-20 [&>*]:pointer-events-auto",
						titleBarClearsContent ? "top-12" : "top-0"
					)}
				>
					<AutoUpdater />
				</div>
			</SidebarInset>

			{/* Global "Ask Ryu" assistant: a Notion-AI-style chat that floats over or
			    docks beside any page, carrying the current page as context and able to
			    promote itself to a full `/chat` tab. Mounted only while open so its
			    `useChat` fully unmounts on close — that is what lets the "open full
			    screen" hand-off mount a `/chat` tab on the SAME conversation id without
			    two live `useChat` instances colliding on that id. The conversation
			    survives close/reopen because its id lives in the assistant store. */}
			{assistantMode === "sidebar" && <AssistantPanel />}
			{showAssistantDock && !chatPaneVisible && <AssistantDock />}
		</TabDndProvider>
	);
}

function getSavedSidebarWidth(): number {
	try {
		const v = localStorage.getItem(SIDEBAR_WIDTH_KEY);
		if (v) {
			return Math.max(
				MIN_SIDEBAR_WIDTH,
				Math.min(MAX_SIDEBAR_WIDTH, Number(v))
			);
		}
	} catch {
		// localStorage may be unavailable; fall back to the default width.
	}
	return DEFAULT_SIDEBAR_WIDTH;
}

/** When this window was spawned as a tear-off ("open in new window"), the Rust
    command seeds `?window=tab&…` so the new window opens straight onto that one
    conversation/node instead of a blank chat. Read once at mount. */
function readInitialTab(): InitialTab | undefined {
	try {
		const p = new URLSearchParams(window.location.search);
		if (p.get("window") !== "tab") {
			return undefined;
		}
		return {
			path: p.get("path") || "/chat",
			title: p.get("title") || undefined,
			conversationId: p.get("conv") || undefined,
			node: p.get("node") || undefined,
		};
	} catch {
		return undefined;
	}
}

export default function Layout() {
	const initialTabRef = useRef(readInitialTab());
	const [sidebarWidth, setSidebarWidth] = useState(getSavedSidebarWidth);
	const handleSidebarWidthChange = (w: number) => {
		setSidebarWidth(w);
		try {
			localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
		} catch {
			// Persisting the width is best-effort; ignore storage failures.
		}
	};

	useEffect(() => {
		const handler = (e: Event) => {
			setSidebarWidth((e as CustomEvent<number>).detail);
		};
		window.addEventListener("ryu:sidebar-width", handler);
		return () => window.removeEventListener("ryu:sidebar-width", handler);
	}, []);

	return (
		<TooltipProvider delay={0}>
			<ChatDisplayPrefs>
				<TabsProvider initialTab={initialTabRef.current}>
					<TitleBarProvider>
						<SidebarProvider
							style={
								{
									"--sidebar-width": `${sidebarWidth}px`,
								} as React.CSSProperties
							}
						>
							<ChatHistoryProvider>
								<SpacesProvider>
									<SystemStatusProvider>
										<HotkeysProvider
											registry={DESKTOP_HOTKEYS}
											storage={coreKvHotkeyStorage}
										>
											<DesktopReportHost>
												<ProjectDockHost>
													<LayoutContent
														onSidebarWidthChange={handleSidebarWidthChange}
														sidebarWidth={sidebarWidth}
													/>
												</ProjectDockHost>
											</DesktopReportHost>
										</HotkeysProvider>
									</SystemStatusProvider>
								</SpacesProvider>
							</ChatHistoryProvider>
						</SidebarProvider>
					</TitleBarProvider>
				</TabsProvider>
			</ChatDisplayPrefs>
		</TooltipProvider>
	);
}
