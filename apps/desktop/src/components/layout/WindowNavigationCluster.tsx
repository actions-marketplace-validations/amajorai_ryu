import {
	ArrowLeft01Icon,
	ArrowRight01Icon,
	Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@ryu/ui/components/tooltip.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import {
	IconSidebarClosed,
	IconSidebarOpen,
} from "../icons/SidebarToggleIcon.tsx";

interface WindowNavigationClusterProps {
	canGoBack: boolean;
	canGoForward: boolean;
	isMac: boolean;
	isMobile: boolean;
	navClusterPosition: string;
	onGoBack: () => void;
	onGoForward: () => void;
	onSearch: () => void;
	onToggleSidebar: () => void;
	showSearch?: boolean;
	sidebarShown: boolean;
}

export function WindowNavigationCluster({
	canGoBack,
	canGoForward,
	isMac,
	isMobile,
	navClusterPosition,
	onGoBack,
	onGoForward,
	onSearch,
	showSearch = true,
	onToggleSidebar,
	sidebarShown,
}: WindowNavigationClusterProps) {
	return (
		<div
			className={cn(
				"fixed z-[60] flex flex-row items-center gap-1",
				navClusterPosition
			)}
			data-tauri-drag-region={false}
			data-testid="window-navigation-cluster"
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
									onClick={onGoBack}
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
									onClick={onGoForward}
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
							aria-label={sidebarShown ? "Close navigation" : "Open navigation"}
							className="size-8"
							onClick={onToggleSidebar}
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
			{showSearch && (
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label="Search"
								className="size-8"
								onClick={onSearch}
								size="icon"
								variant="ghost"
							>
								<HugeiconsIcon className="size-4" icon={Search01Icon} />
							</Button>
						}
					/>
					<TooltipContent>Search {isMac ? "⌘K" : "Ctrl K"}</TooltipContent>
				</Tooltip>
			)}
		</div>
	);
}
