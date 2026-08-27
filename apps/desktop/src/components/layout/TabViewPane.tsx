import { cn } from "@ryu/ui/lib/utils.ts";
import type { CSSProperties, ReactNode } from "react";
import type { Tab } from "@/src/contexts/TabsContext.tsx";
import {
	CurrentTabIdProvider,
	IsActiveTabProvider,
} from "@/src/contexts/TabsContext.tsx";
import { RouteOutlet } from "@/src/contributions/RouteOutlet.tsx";
import { TabGlyph } from "./TitleBar.tsx";

export interface TabViewPaneProps {
	children?: ReactNode;
	className?: string;
	focused: boolean;
	onClose: () => void;
	onFocus: () => void;
	style?: CSSProperties;
	tab: Tab;
}

export function TabViewPane({
	children,
	className,
	focused,
	onClose,
	onFocus,
	style,
	tab,
}: TabViewPaneProps) {
	return (
		<IsActiveTabProvider isActive={focused}>
			<CurrentTabIdProvider tabId={tab.id}>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: an unfocused live pane must focus before its route controls handle the pointer event */}
				<section
					aria-label={`${tab.title} tab`}
					className={cn(
						"relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
						className
					)}
					data-focused={focused}
					data-tab-view-pane={tab.id}
					onMouseDownCapture={focused ? undefined : onFocus}
					role="group"
					style={style}
				>
					{children}
					{tab.unloaded ? (
						<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
							<TabGlyph
								className="size-8 text-muted-foreground/70"
								logoSize="32px"
								path={tab.path}
								unloaded
							/>
							<div>
								<p className="font-medium text-sm">{tab.title}</p>
								<p className="mt-1 text-muted-foreground text-xs">
									This tab is unloaded to save memory.
								</p>
							</div>
							<button
								className="rounded-full border border-border/70 bg-background px-3 py-1.5 font-medium text-xs shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								onClick={onFocus}
								type="button"
							>
								Reload tab
							</button>
						</div>
					) : (
						<div className="min-h-0 min-w-0 flex-1 overflow-hidden">
							<RouteOutlet onClose={onClose} tab={tab} />
						</div>
					)}
				</section>
			</CurrentTabIdProvider>
		</IsActiveTabProvider>
	);
}
