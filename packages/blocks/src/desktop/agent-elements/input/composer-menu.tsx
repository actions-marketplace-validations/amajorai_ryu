"use client";

import { cn } from "@ryu/ui/lib/utils";
import {
	type ReactNode,
	type RefObject,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

export interface ComposerMenuItem {
	badge?: string;
	description?: string;
	disabled?: boolean;
	icon?: ReactNode;
	id: string;
	keywords?: string[];
	label: string;
	trailing?: ReactNode;
}

export interface ComposerMenuGroup {
	id: string;
	items: ComposerMenuItem[];
	label: string;
}

export interface ComposerMenuProps {
	anchorRef?: RefObject<HTMLElement | null>;
	className?: string;
	embedded?: boolean;
	groups: ComposerMenuGroup[];
	onDismiss: () => void;
	onSelect: (item: ComposerMenuItem) => void;
	query?: string;
}

/** One searchable, keyboard-driven list used by +, @ mentions, and / commands. */
export function ComposerMenu({
	anchorRef,
	className,
	embedded = false,
	groups,
	onDismiss,
	onSelect,
	query = "",
}: ComposerMenuProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const [active, setActive] = useState(0);
	const normalizedQuery = query.trim().toLowerCase();
	const filteredGroups = useMemo(
		() =>
			groups.flatMap((group) => {
				const items = group.items.filter((item) => {
					if (!normalizedQuery) {
						return true;
					}
					return [item.label, item.description ?? "", ...(item.keywords ?? [])]
						.join(" ")
						.toLowerCase()
						.includes(normalizedQuery);
				});
				return items.length > 0 ? [{ ...group, items }] : [];
			}),
		[groups, normalizedQuery]
	);
	const flat = useMemo(
		() => filteredGroups.flatMap((group) => group.items),
		[filteredGroups]
	);

	useEffect(() => setActive(0), [normalizedQuery, flat.length]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onDismiss();
				return;
			}
			if (flat.length === 0) {
				return;
			}
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setActive((index) => (index + 1) % flat.length);
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				setActive((index) => (index - 1 + flat.length) % flat.length);
			} else if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				event.stopPropagation();
				const item = flat[Math.min(active, flat.length - 1)];
				if (item && !item.disabled) {
					onSelect(item);
				}
			}
		};
		document.addEventListener("keydown", handleKeyDown, { capture: true });
		return () =>
			document.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [active, flat, onDismiss, onSelect]);

	useEffect(() => {
		if (!anchorRef) {
			return;
		}
		const handlePointerDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (
				!(
					rootRef.current?.contains(target) ||
					anchorRef.current?.contains(target)
				)
			) {
				onDismiss();
			}
		};
		document.addEventListener("mousedown", handlePointerDown);
		return () => document.removeEventListener("mousedown", handlePointerDown);
	}, [anchorRef, onDismiss]);

	let rowIndex = -1;
	return (
		<div
			className={cn(
				"overflow-y-auto",
				embedded
					? "max-h-[min(26rem,55vh)]"
					: "max-h-[min(26rem,55vh)] w-[min(44rem,calc(100vw-2rem))] rounded-2xl border border-border/70 bg-popover/95 p-1.5 shadow-xl backdrop-blur",
				className
			)}
			ref={rootRef}
			role="listbox"
		>
			{filteredGroups.map((group) => (
				<div className="py-0.5" key={group.id}>
					<div className="px-2 pt-1.5 pb-1 text-muted-foreground text-xs">
						{group.label}
					</div>
					{group.items.map((item) => {
						rowIndex += 1;
						const index = rowIndex;
						return (
							<button
								aria-selected={index === active}
								className={cn(
									"flex min-h-9 w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
									index === active && "bg-accent",
									item.disabled && "pointer-events-none opacity-45"
								)}
								disabled={item.disabled}
								key={item.id}
								onClick={() => onSelect(item)}
								onMouseDown={(event) => event.preventDefault()}
								onMouseEnter={() => setActive(index)}
								role="option"
								type="button"
							>
								{item.icon ? (
									<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
										{item.icon}
									</span>
								) : null}
								<span className="min-w-0 flex-1">
									<span className="block truncate">{item.label}</span>
									{item.description ? (
										<span className="block truncate text-muted-foreground text-xs">
											{item.description}
										</span>
									) : null}
								</span>
								{item.badge ? (
									<span className="shrink-0 text-[11px] text-muted-foreground">
										{item.badge}
									</span>
								) : null}
								{item.trailing}
							</button>
						);
					})}
				</div>
			))}
			{flat.length === 0 ? (
				<div className="px-3 py-8 text-center text-muted-foreground text-sm">
					No matches
				</div>
			) : null}
		</div>
	);
}
