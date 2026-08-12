// apps/desktop/src/components/agents/AgentBadgeCard.tsx
//
// An agent as a grid item: the employee badge itself, with a thin footer under
// it for the surface's own controls.
//
// It exists because two grids show agents — the Store's Agents tab and the
// Library's — and both want the same object. The badge is the shared card
// (`EmployeeBadge` → `PassCardShell`), so the only thing this adds is the part a
// grid needs and a settings page does not: a click target that also reaches the
// keyboard, the selected wash, the right-click menu, and somewhere to hang an
// install button or a favourite star.
//
// The badge is mounted `still`. It keeps every bit of its look — the metal ring,
// the depth, the seeded backdrop, both faces — and keeps answering the pointer
// with a tilt, but it does not turn or float on its own. A screen of twenty
// revolving cards is unusable, and with no idle turn a stray drag would leave a
// card permanently skewed (see `PassCardShell`'s `still`).

import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
} from "@ryu/ui/components/context-menu.tsx";
import { EmployeeBadge } from "@ryu/ui/components/employee-badge.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";

export interface AgentBadgeCardProps {
	/** The footer's right-hand control: the Store's install action, the Library's
	 *  favourite star. Nested controls must stop propagation themselves — the
	 *  whole card opens the item. */
	action?: ReactNode;
	className?: string;
	/** Right-click menu content. Omitted → the card has no context menu at all,
	 *  matching `StoreCatalogCard`. */
	contextMenu?: ReactNode;
	/** Seeds the badge id and the generative backdrop — the agent's own id. */
	employeeId: string;
	/** The footer's left-hand content: a "Built-in" chip, a source label. An
	 *  agent's own brand mark does NOT belong here — it goes on the card face via
	 *  {@link AgentBadgeCardProps.logo}, where it is actually legible. */
	footer?: ReactNode;
	/** ISO timestamp the agent was created, printed as "Hired …". */
	hiredAt?: string;
	/** The agent's brand mark, drawn large on the badge face above the name. */
	logo?: ReactNode;
	name: string;
	onOpen: () => void;
	/** The line under the name — the agent's description or engine. */
	role?: string | null;
	/** Draws the same wash `StoreCatalogCard` uses for the open listing. */
	selected?: boolean;
}

/**
 * One agent, as a badge in a grid. The whole surface opens the item; it is NOT a
 * `<button>` for the reason the Library's own card is not — the footer holds
 * interactive controls, which cannot be nested inside one — so it carries the
 * `role="button"` + Enter/Space pattern instead.
 */
export function AgentBadgeCard({
	action,
	className,
	contextMenu,
	employeeId,
	footer,
	hiredAt,
	logo,
	name,
	onOpen,
	role,
	selected = false,
}: AgentBadgeCardProps) {
	const { resolvedTheme } = useTheme();

	const card = (
		<div
			className={cn(
				"flex flex-col gap-2 rounded-2xl p-2 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/30",
				selected ? "bg-accent" : "hover:bg-accent/50",
				className
			)}
			onClick={onOpen}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					// Space is the browser's scroll key on anything that is not really a
					// button, so opening the item would also jump the grid.
					event.preventDefault();
					onOpen();
				}
			}}
			role="button"
			tabIndex={0}
		>
			<EmployeeBadge
				employeeId={employeeId}
				hiredAt={hiredAt}
				logo={logo}
				metalTheme={resolvedTheme === "light" ? "light" : "dark"}
				name={name}
				role={role ?? undefined}
				still
			/>
			{footer || action ? (
				<div className="flex min-h-8 items-center justify-between gap-2 px-1">
					<span className="flex min-w-0 items-center gap-2">{footer}</span>
					<span className="shrink-0">{action}</span>
				</div>
			) : null}
		</div>
	);

	if (!contextMenu) {
		return card;
	}

	return (
		<ContextMenu>
			<ContextMenuTrigger render={card} />
			<ContextMenuContent align="end">{contextMenu}</ContextMenuContent>
		</ContextMenu>
	);
}
