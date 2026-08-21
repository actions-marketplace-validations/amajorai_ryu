import { ArrowDown01Icon, Message01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandList,
} from "@ryu/ui/components/command.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@ryu/ui/components/popover.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import type { ReactNode } from "react";
import { useState } from "react";
import { AnimatedTitle } from "@/src/components/layout/animated-title.tsx";
import {
	TabSearchRow,
	type TabSearchTab,
} from "@/src/components/layout/tab-search-dialog.tsx";

export interface TabDropdownProps {
	activateTab: (id: string) => void;
	activeIcon?: ReactNode;
	activeTabId: string;
	closeTab: (id: string) => void;
	tabs: TabSearchTab[];
}

/** The compact title-bar replacement for the full horizontal tab strip. */
export function TabDropdown({
	activeIcon,
	activeTabId,
	activateTab,
	closeTab,
	tabs,
}: TabDropdownProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const activeTab = tabs.find((tab) => tab.id === activeTabId);
	const activeTitle = activeTab?.title || "New chat";
	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		if (!next) {
			setQuery("");
		}
	};

	return (
		<Popover onOpenChange={handleOpenChange} open={open}>
			<PopoverTrigger
				render={
					<button
						aria-label="Open tabs"
						className={cn(
							"group/tab-dropdown flex min-w-0 max-w-[min(24rem,50vw)] items-center gap-1.5 rounded-3xl border-0 bg-transparent px-2.5 py-1.5 text-muted-foreground text-sm shadow-none outline-none transition-[background-color,color] duration-150 ease-out hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
						)}
						data-tab-dropdown-trigger
						data-tauri-drag-region={false}
						title="Open tabs"
						type="button"
					>
						<span className="flex size-4 shrink-0 items-center justify-center">
							{activeIcon ?? (
								<HugeiconsIcon className="size-3.5" icon={Message01Icon} />
							)}
						</span>
						<span
							className="min-w-0 truncate text-left"
							data-tab-dropdown-label
						>
							<AnimatedTitle text={activeTitle} />
						</span>
						<HugeiconsIcon
							className="size-3.5 shrink-0 text-muted-foreground/60"
							icon={ArrowDown01Icon}
						/>
					</button>
				}
			/>
			<PopoverContent
				align="start"
				className="w-[min(28rem,calc(100vw-2rem))] p-0"
				data-tab-dropdown-menu
			>
				<Command>
					<CommandInput
						aria-label="Search open tabs"
						autoFocus
						onValueChange={setQuery}
						placeholder="Search open tabs…"
						value={query}
					/>
					<CommandList className="max-h-[min(60vh,28rem)] p-1">
						<CommandEmpty>No open tabs match your search.</CommandEmpty>
						<CommandGroup
							heading={`${tabs.length} open tab${tabs.length === 1 ? "" : "s"}`}
						>
							{tabs.map((tab) => (
								<TabSearchRow
									activateTab={activateTab}
									activeTabId={activeTabId}
									closeTab={closeTab}
									key={tab.id}
									setOpen={handleOpenChange}
									tab={tab}
								/>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
