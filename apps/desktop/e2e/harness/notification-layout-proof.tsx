import {
	CheckListIcon,
	Megaphone01Icon,
	Notification01Icon,
	Shield01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { RangeSlider } from "@ryu/ui/components/motion/range-slider";
import { NotificationStack } from "@ryu/ui/components/notification-stack";
import { cn } from "@ryu/ui/lib/utils";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

type Layout = "split" | "grouped" | "unified";

const LAYOUTS: Array<{
	description: string;
	id: Layout;
	label: string;
}> = [
	{
		description: "Announcements keep their own stack above the Inbox tray.",
		id: "split",
		label: "Split",
	},
	{
		description: "One tray keeps Inbox and announcements in named groups.",
		id: "grouped",
		label: "Grouped",
	},
	{
		description: "Everything shares one expandable notification stack.",
		id: "unified",
		label: "Unified",
	},
];

const ICONS: Record<string, IconSvgElement> = {
	announcement: Megaphone01Icon,
	approval: Shield01Icon,
	task: CheckListIcon,
	notification: Notification01Icon,
};

const ITEMS = [
	{
		category: "Announcement",
		description: "New sidebar controls are ready to try.",
		id: "announcement",
		icon: "announcement",
		title: "Appearance update",
	},
	{
		category: "Approval",
		description: "A scheduled tool call is waiting for your sign-off.",
		id: "approval",
		icon: "approval",
		title: "Approve scheduled run",
	},
	{
		category: "Task",
		description: "A conversation suggests this check-off.",
		id: "task",
		icon: "task",
		title: "Finished the release notes?",
	},
	{
		category: "Notification",
		description: "The desktop companion finished syncing.",
		id: "notification",
		icon: "notification",
		title: "Sync complete",
	},
] as const;

function DemoItems({
	onActivate,
	onMarkRead,
	readIds,
	showCategory,
}: {
	onActivate: (title: string) => void;
	onMarkRead: (id: string) => void;
	readIds: Set<string>;
	showCategory?: boolean;
}) {
	return ITEMS.map((item) => ({
		actions: (
			<button
				aria-label={`Mark ${item.title} read`}
				className="relative z-20 rounded-lg px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				onClick={() => onMarkRead(item.id)}
				type="button"
			>
				{readIds.has(item.id) ? "Read" : "Mark read"}
			</button>
		),
		ariaLabel: `Open ${item.title}`,
		description: item.description,
		id: item.id,
		leading: (
			<span className="flex size-7 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
				<HugeiconsIcon className="size-3.5" icon={ICONS[item.icon]} />
			</span>
		),
		muted: readIds.has(item.id),
		onActivate: () => onActivate(item.title),
		title: showCategory ? (
			<span className="flex min-w-0 items-center gap-1.5">
				<span className="shrink-0 rounded bg-muted px-1 py-0.5 font-normal text-[9px] text-muted-foreground uppercase">
					{item.category}
				</span>
				<span className="truncate">{item.title}</span>
			</span>
		) : (
			item.title
		),
		unread: !readIds.has(item.id),
	}));
}

function NotificationLayoutProof() {
	const [layout, setLayout] = useState<Layout>("unified");
	const [readIds, setReadIds] = useState<Set<string>>(new Set());
	const [lastAction, setLastAction] = useState("Ready to preview");
	const step = LAYOUTS.findIndex((item) => item.id === layout);
	const active = LAYOUTS[step] ?? LAYOUTS[2];
	const items = useMemo(
		() =>
			DemoItems({
				onActivate: (title) => setLastAction(`Opened ${title}`),
				onMarkRead: (id) => {
					const item = ITEMS.find((candidate) => candidate.id === id);
					if (item) {
						setReadIds((current) => new Set(current).add(id));
						setLastAction(`Marked ${item.title} read`);
					}
				},
				readIds,
			}),
		[readIds]
	);
	const groupedItems = useMemo(
		() =>
			DemoItems({
				onActivate: (title) => setLastAction(`Opened ${title}`),
				onMarkRead: (id) => {
					const item = ITEMS.find((candidate) => candidate.id === id);
					if (item) {
						setReadIds((current) => new Set(current).add(id));
						setLastAction(`Marked ${item.title} read`);
					}
				},
				readIds,
				showCategory: true,
			}),
		[readIds]
	);
	const announcements = items.filter((item) => item.id === "announcement");
	const inbox = items.filter((item) => item.id !== "announcement");

	return (
		<main
			className="min-h-screen bg-[#09090b] px-6 py-8 text-zinc-100"
			data-testid="notification-layout-proof"
		>
			<div className="mx-auto flex max-w-5xl flex-col gap-6">
				<header className="flex items-start justify-between gap-6">
					<div>
						<p className="font-medium text-[11px] text-zinc-500 uppercase tracking-[0.18em]">
							Ryu desktop verification
						</p>
						<h1 className="mt-2 font-semibold text-3xl tracking-tight">
							Notification tray
						</h1>
						<p className="mt-2 max-w-2xl text-sm text-zinc-400 leading-6">
							The sidebar announcement stack and Inbox can share one compact
							space, or stay separate when that is easier to scan.
						</p>
					</div>
					<div
						className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 font-medium text-emerald-300 text-xs"
						data-testid="proof-status"
					>
						{lastAction}
					</div>
				</header>

				<section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
					<div className="flex items-start justify-between gap-4">
						<div>
							<p className="font-medium text-sm">Notification layout</p>
							<p className="mt-1 max-w-xl text-xs text-zinc-500">
								{active.description}
							</p>
						</div>
						<span
							className="rounded-full bg-white/10 px-2.5 py-1 font-medium text-xs"
							data-testid="notification-layout-value"
						>
							{active.label}
						</span>
					</div>
					<div className="mt-5" data-testid="notification-layout-slider">
						<RangeSlider
							aria-label="Notification layout"
							className="h-9"
							max={LAYOUTS.length - 1}
							min={0}
							onValueChange={(value) =>
								setLayout(LAYOUTS[Math.round(value)]?.id ?? "unified")
							}
							step={1}
							value={step}
						/>
						<div className="mt-2 flex justify-between text-[10px] text-zinc-500">
							{LAYOUTS.map((item) => (
								<span
									className={cn(
										item.id === layout && "font-medium text-zinc-100"
									)}
									key={item.id}
								>
									{item.label}
								</span>
							))}
						</div>
					</div>
				</section>

				<section className="grid gap-5 lg:grid-cols-[280px_1fr]">
					<aside className="rounded-3xl border border-white/10 bg-[#111113] p-3">
						<div className="mb-3 flex items-center justify-between px-1">
							<span className="font-medium text-xs">Sidebar footer</span>
							<span className="text-[10px] text-zinc-500">live preview</span>
						</div>
						{layout === "split" ? (
							<div className="flex flex-col gap-3">
								<div data-testid="announcement-surface">
									<p className="mb-1 px-1 text-[10px] text-zinc-500 uppercase tracking-wider">
										Announcements
									</p>
									<NotificationStack
										defaultExpanded
										items={announcements}
										key="split-announcements"
										maxVisible={3}
									/>
								</div>
								<div data-testid="inbox-surface">
									<p className="mb-1 px-1 text-[10px] text-zinc-500 uppercase tracking-wider">
										Inbox
									</p>
									<NotificationStack
										defaultExpanded
										items={inbox}
										key="split-inbox"
										maxVisible={3}
									/>
								</div>
							</div>
						) : (
							<div data-testid="notification-surface">
								<p className="mb-1 px-1 text-[10px] text-zinc-500 uppercase tracking-wider">
									Notifications
								</p>
								<NotificationStack
									defaultExpanded={layout === "grouped"}
									items={layout === "grouped" ? groupedItems : items}
									key={layout}
									maxVisible={5}
									onViewAll={() => setLastAction("Opened full Inbox")}
								/>
							</div>
						)}
					</aside>

					<div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.02] p-5">
						<div>
							<p className="font-medium text-sm">What this proves</p>
							<p className="mt-1 text-xs text-zinc-500 leading-5">
								The same stacked-card primitive handles announcements and Inbox
								content. Hover, focus, tap, or use the footer to expand it.
							</p>
						</div>
						<div className="grid gap-2 sm:grid-cols-3">
							{LAYOUTS.map((item) => (
								<div
									className={cn(
										"rounded-2xl border px-3 py-3",
										item.id === layout
											? "border-primary/40 bg-primary/10"
											: "border-white/10 bg-white/[0.025]"
									)}
									data-testid={`mode-${item.id}`}
									key={item.id}
								>
									<p className="font-medium text-xs">{item.label}</p>
									<p className="mt-1 text-[11px] text-zinc-500 leading-4">
										{item.description}
									</p>
								</div>
							))}
						</div>
						<div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-zinc-400">
							<p className="font-medium text-zinc-200">Interaction check</p>
							<p className="mt-1 leading-5">
								The orange count bubble stays visible while the stack expands,
								and read actions remain in the card action slot instead of
								competing with the row click.
							</p>
						</div>
					</div>
				</section>
			</div>
		</main>
	);
}

createRoot(document.getElementById("root")!).render(
	<NotificationLayoutProof />
);
