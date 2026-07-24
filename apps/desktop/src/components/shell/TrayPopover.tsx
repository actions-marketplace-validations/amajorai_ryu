// apps/desktop/src/components/shell/TrayPopover.tsx
//
// Shared chrome for the sidebar-footer tray popovers (Inbox, Downloads). Both
// are the same object — a glass panel anchored to a 28px icon button — so they
// share one shell here instead of each hand-rolling headers, rows, empty states
// and the "open the full page" footer.
//
// Design rules the two trays obey, so they read as one component:
//   * One row grid, always: 28px glyph · title + one meta line · action slot.
//     Rows are inset cards (radius concentric with the panel: 24px panel − 6px
//     padding = 18px row), never full-bleed `divide-y` slabs.
//   * One meta line, dot-separated and truncated. Timestamps, sizes, speeds and
//     risk tags all live there — nothing gets its own stacked line, so every row
//     is the same height and the list scans as a column.
//   * Actions are legible, not decorative: the affirmative one is a labelled
//     pill, the rest are icon ghosts in a fixed-width slot (so hover never
//     reflows the row). Nothing that decides something is hover-only.
//   * Tone is carried by the glyph and the meta text, never by tinted row
//     backgrounds — a list of red-washed tiles reads as an error state.

import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { PopoverContent } from "@ryu/ui/components/popover";
import { Spinner } from "@ryu/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@ryu/ui/components/tooltip";
import { cn } from "@ryu/ui/lib/utils";
import {
	type ComponentProps,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

export type TrayTone = "default" | "danger" | "success" | "primary";

/** The 28px footer icon button both trays hang off. */
export const trayTriggerClass =
	"gooey-tap relative flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted data-[popup-open]:text-foreground";

/** Row radius, concentric with the panel (24px panel − 6px padding). */
const ROW_RADIUS = "rounded-[18px]";

/**
 * The count bubble both triggers overlay. Stays mounted so the
 * transitions.dev notification-badge (03) can pop it in/out rather than
 * hard-mounting, and so the two trays badge identically.
 */
export function TrayBadge({
	count,
	label,
	tone = "primary",
}: {
	count: number;
	/** Announced to screen readers; the number alone says nothing. */
	label: string;
	tone?: "primary" | "danger";
}) {
	const open = count > 0;
	return (
		<span
			aria-hidden={!open}
			aria-label={open ? `${count} ${label}` : undefined}
			className="t-badge -top-0.5 -right-0.5"
			data-open={open}
		>
			<span
				className={cn(
					"t-badge-dot flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-medium text-[10px] tabular-nums ring-2 ring-sidebar",
					tone === "danger"
						? "bg-destructive text-white"
						: "bg-primary text-primary-foreground"
				)}
			>
				{count > 9 ? "9+" : count}
			</span>
		</span>
	);
}

/**
 * Glass panel sized and padded for a tray list. Slightly more opaque than the
 * house popover: these panels sit over the sidebar footer against arbitrary app
 * chrome, and at 70% the text lost contrast on a dark backdrop.
 */
export function TrayPopoverContent({
	className,
	...props
}: ComponentProps<typeof PopoverContent>) {
	return (
		<PopoverContent
			align="end"
			className={cn(
				"w-[23rem] gap-0 border-border/60 bg-popover/85 p-1.5 shadow-black/10 shadow-xl dark:bg-popover/90",
				className
			)}
			side="top"
			sideOffset={8}
			{...props}
		/>
	);
}

/**
 * Panel header: title + count on the left, quiet text actions on the right, and
 * an optional status line underneath (the downloads aggregate lives there, so
 * the tray answers "how long?" without spending a whole strip on it).
 */
export function TrayHeader({
	actions,
	count,
	status,
	title,
}: {
	actions?: ReactNode;
	count?: number;
	status?: ReactNode;
	title: string;
}) {
	return (
		<div className="flex items-start gap-2 px-2.5 pt-1.5 pb-2">
			<div className="flex min-w-0 flex-col gap-0.5">
				<div className="flex items-center gap-1.5">
					<span className="font-semibold text-[13px] tracking-tight">
						{title}
					</span>
					{count !== undefined && count > 0 && (
						<span className="text-[11px] text-muted-foreground/80 tabular-nums">
							{count}
						</span>
					)}
				</div>
				{status && (
					<span className="truncate text-[11px] text-muted-foreground tabular-nums leading-4">
						{status}
					</span>
				)}
			</div>
			{actions && (
				<div className="-mr-1 ml-auto flex shrink-0 items-center gap-0.5">
					{actions}
				</div>
			)}
		</div>
	);
}

/** Quiet text button for the header/section action slots. */
export function TrayTextButton({
	children,
	disabled,
	onClick,
	tone = "default",
}: {
	children: ReactNode;
	disabled?: boolean;
	onClick: () => void;
	tone?: "default" | "primary";
}) {
	return (
		<button
			className={cn(
				"rounded-lg px-1.5 py-1 font-medium text-[11px] transition-colors disabled:opacity-50",
				tone === "primary"
					? "text-primary hover:bg-primary/10"
					: "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
			)}
			disabled={disabled}
			onClick={onClick}
			type="button"
		>
			{children}
		</button>
	);
}

/** Full-bleed hairline that ignores the panel's inset padding. */
export function TrayDivider({ className }: { className?: string }) {
	return <div className={cn("-mx-1.5 my-1 h-px bg-border/50", className)} />;
}

/**
 * Full-bleed activity line under the header. `percent === null` sweeps the
 * marquee band (same treatment the Progress primitive uses for unknown sizes).
 */
export function TrayProgressLine({ percent }: { percent: number | null }) {
	return (
		<div className="relative -mx-1.5 mt-0.5 mb-1 h-0.5 overflow-hidden bg-border/50">
			{percent === null ? (
				<span className="t-progress-marquee" />
			) : (
				<div
					className="h-full bg-primary/70 transition-[width] duration-500 ease-out"
					style={{ width: `${percent}%` }}
				/>
			)}
		</div>
	);
}

/**
 * Group heading inside the scroller. Sentence case at 11px rather than 10px
 * caps: at tray size the tracked uppercase read as noise between the rows.
 */
export function TraySectionLabel({
	children,
	count,
	trailing,
}: {
	children: ReactNode;
	count?: number;
	trailing?: ReactNode;
}) {
	return (
		<div className="flex h-7 items-center gap-1.5 px-2.5 pt-1">
			<span className="font-medium text-[11px] text-muted-foreground">
				{children}
			</span>
			{count !== undefined && count > 0 && (
				<span className="text-[11px] text-muted-foreground/60 tabular-nums">
					{count}
				</span>
			)}
			{trailing && (
				<div className="-mr-1 ml-auto flex items-center">{trailing}</div>
			)}
		</div>
	);
}

/** The small glyph tile that leads every row. */
export function TrayRowIcon({
	className,
	icon,
	tone = "default",
}: {
	className?: string;
	icon: IconSvgElement;
	tone?: TrayTone;
}) {
	return (
		<span
			className={cn(
				"mt-px flex size-7 shrink-0 items-center justify-center rounded-[10px] bg-muted/60 text-muted-foreground ring-1 ring-border/50 ring-inset",
				tone === "danger" && "text-destructive",
				tone === "success" && "text-success",
				tone === "primary" && "text-primary",
				className
			)}
		>
			<HugeiconsIcon icon={icon} size={14} />
		</span>
	);
}

/**
 * A labelled affirmative action — the one control per row that must be read.
 *
 * Resting state is a neutral outline chip, not a tinted one: three stacked
 * green "Approve" pills read as a traffic light, and a `primary`-tinted chip is
 * just grey in this near-monochrome palette. The colour arrives on hover, where
 * it confirms what the click is about to do.
 */
export function TrayAction({
	busy,
	label,
	onClick,
	tone = "primary",
}: {
	busy?: boolean;
	label: string;
	onClick: () => void;
	tone?: "primary" | "success";
}) {
	return (
		<button
			className={cn(
				"flex h-6 shrink-0 items-center gap-1 rounded-lg border border-border/70 bg-background/60 px-2 font-medium text-[11px] text-foreground/80 transition-colors disabled:opacity-60",
				tone === "success"
					? "hover:border-success hover:bg-success hover:text-white"
					: "hover:border-primary hover:bg-primary hover:text-primary-foreground"
			)}
			disabled={busy}
			onClick={onClick}
			type="button"
		>
			{busy && <Spinner className="size-3" />}
			{label}
		</button>
	);
}

/** A 24px ghost control. Icon-only, tooltipped, sized for a dense row. */
export function TrayIconAction({
	icon,
	label,
	onClick,
	tone = "default",
}: {
	icon: IconSvgElement;
	label: string;
	onClick: () => void;
	tone?: "default" | "danger";
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						aria-label={label}
						className={cn(
							"flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
							tone === "danger" &&
								"hover:bg-destructive/10 hover:text-destructive"
						)}
						onClick={onClick}
						type="button"
					>
						<HugeiconsIcon icon={icon} size={13} />
					</button>
				}
			/>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

/** Dot-separated meta segments, pre-truncated to one line. */
export function trayMeta(
	...parts: (string | null | undefined | false)[]
): string {
	return parts.filter(Boolean).join(" · ");
}

/**
 * The one row every tray list is built from.
 *
 * `onOpen` is wired as a full-bleed underlay button rather than by wrapping the
 * text: the whole row is then a single click target, and the action controls sit
 * above it instead of being nested inside another button (which is invalid, and
 * left the old rows with a hover highlight wider than their hit area).
 */
export function TrayRow({
	actions,
	busy,
	icon,
	meta,
	metaTone = "default",
	onOpen,
	openLabel,
	progress,
	title,
	tone = "default",
	trailing,
}: {
	actions?: ReactNode;
	/** Swaps the whole action slot for a spinner, keeping the row's width. */
	busy?: boolean;
	icon: IconSvgElement;
	meta?: ReactNode;
	metaTone?: "default" | "danger";
	onOpen?: () => void;
	openLabel?: string;
	/** `undefined` draws no bar; `null` draws an indeterminate one. */
	progress?: number | null;
	title: ReactNode;
	tone?: TrayTone;
	/** Right-aligned stamp on the title line (kept out of the meta line). */
	trailing?: ReactNode;
}) {
	return (
		<div
			className={cn(
				"group/row relative flex items-start gap-2.5 px-2 py-2 transition-colors",
				ROW_RADIUS,
				onOpen && "hover:bg-muted/50"
			)}
		>
			{onOpen && (
				<button
					aria-label={openLabel}
					className={cn("absolute inset-0", ROW_RADIUS)}
					onClick={onOpen}
					type="button"
				/>
			)}
			<TrayRowIcon icon={icon} tone={tone} />
			{/* Text ignores the pointer only when there's an underlay button to fall
			    through to; otherwise it would swallow its own `title` tooltip. */}
			<div
				className={cn(
					"relative flex min-w-0 flex-1 flex-col",
					onOpen && "pointer-events-none"
				)}
			>
				<div className="flex items-baseline gap-2">
					<span className="min-w-0 flex-1 truncate font-medium text-[13px] leading-5">
						{title}
					</span>
					{trailing && (
						<span className="shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">
							{trailing}
						</span>
					)}
				</div>
				{meta && (
					<span
						className={cn(
							"mt-0.5 truncate text-[11px] tabular-nums leading-4",
							metaTone === "danger"
								? "text-destructive/90"
								: "text-muted-foreground"
						)}
					>
						{meta}
					</span>
				)}
				{progress !== undefined && (
					// Under the meta line, not between it and the title: sitting directly
					// beneath the title the bar read as an underline rather than as
					// progress. The track is explicit so a barely-started download still
					// shows how far it has to go.
					<div className="relative mt-2 h-[3px] overflow-hidden rounded-full bg-foreground/10">
						{progress === null ? (
							<span className="t-progress-marquee" />
						) : (
							<div
								className="h-full rounded-full bg-primary/80 transition-[width] duration-500 ease-out"
								style={{ width: `${progress}%` }}
							/>
						)}
					</div>
				)}
			</div>
			<div className="relative flex shrink-0 items-center gap-1">
				{busy ? (
					<span className="flex size-6 items-center justify-center">
						<Spinner className="size-3.5 text-muted-foreground" />
					</span>
				) : (
					actions
				)}
			</div>
		</div>
	);
}

/**
 * Scrolling body. The fade is a mask driven by actual scroll position, so a
 * short list is never clipped and the last row of a long one doesn't sit under
 * a permanent grey smear (a gradient painted over glass, as before, dirtied the
 * panel rather than suggesting depth).
 */
export function TrayScroll({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [fade, setFade] = useState({ bottom: false, top: false });

	const measure = useCallback(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const overflow = el.scrollHeight - el.clientHeight;
		setFade({
			bottom: overflow > 1 && el.scrollTop < overflow - 1,
			top: el.scrollTop > 1,
		});
	}, []);

	useEffect(() => {
		measure();
		const el = ref.current;
		if (!el || typeof ResizeObserver === "undefined") {
			return;
		}
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		for (const child of Array.from(el.children)) {
			observer.observe(child);
		}
		return () => observer.disconnect();
	}, [measure]);

	let mask: string | undefined;
	if (fade.top && fade.bottom) {
		mask =
			"linear-gradient(to bottom, transparent 0, black 1.25rem, black calc(100% - 1.25rem), transparent 100%)";
	} else if (fade.bottom) {
		mask =
			"linear-gradient(to bottom, black calc(100% - 1.25rem), transparent 100%)";
	} else if (fade.top) {
		mask = "linear-gradient(to bottom, transparent 0, black 1.25rem)";
	}

	return (
		<div
			className={cn(
				"flex max-h-[20rem] flex-col overflow-y-auto overscroll-contain [scrollbar-width:thin]",
				className
			)}
			onScroll={measure}
			ref={ref}
			style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
		>
			{children}
		</div>
	);
}

/** Centred nothing-here state, sized for a popover rather than a page. */
export function TrayEmpty({
	description,
	icon,
	title,
}: {
	description: string;
	icon: IconSvgElement;
	title: string;
}) {
	return (
		<div className="flex flex-col items-center gap-2 px-8 py-7 text-center">
			<span className="flex size-10 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground ring-1 ring-border/50 ring-inset">
				<HugeiconsIcon icon={icon} size={17} />
			</span>
			<span className="font-medium text-[13px]">{title}</span>
			<p className="text-balance text-[11px] text-muted-foreground leading-relaxed">
				{description}
			</p>
		</div>
	);
}

/** The "open the full page" action pinned under every tray. */
export function TrayFooter({
	label,
	onClick,
}: {
	label: string;
	onClick: () => void;
}) {
	return (
		<>
			<TrayDivider />
			<button
				className={cn(
					"flex w-full items-center gap-1.5 px-2.5 py-2 font-medium text-[12px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
					ROW_RADIUS
				)}
				onClick={onClick}
				type="button"
			>
				<span>{label}</span>
				<HugeiconsIcon
					className="ml-auto opacity-70"
					icon={ArrowUpRight01Icon}
					size={13}
				/>
			</button>
		</>
	);
}
