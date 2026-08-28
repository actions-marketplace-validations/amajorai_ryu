import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@ryu/ui/lib/utils";
import {
	Bot,
	Check,
	ChevronRight,
	FileCheck2,
	type LucideIcon,
	Settings2,
	Workflow,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import type { LandingCardTone } from "./landing-card-tones.ts";
import {
	LANDING_CARD_TONES,
	landingCardSurfaceClass,
} from "./landing-card-tones.ts";

interface ProductSurfaceCardData {
	description: string;
	href: string;
	icon: LucideIcon;
	id: "apps" | "bot" | "console";
	label: string;
	tone: LandingCardTone;
	visual: ReactNode;
}

function WorkflowCardVisual() {
	return (
		<div className="space-y-2.5">
			<div className="flex items-center gap-2 text-[10px] text-foreground/50 uppercase tracking-[0.14em]">
				<Workflow aria-hidden="true" className="size-3.5 text-foreground/60" />
				Example workflows
			</div>
			<div className="flex items-center gap-2 rounded-xl bg-white/60 px-2.5 py-2.5 text-[10px] dark:bg-white/[0.06]">
				<FileCheck2
					aria-hidden="true"
					className="size-3.5 shrink-0 text-emerald-600"
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-foreground/75">
						Policy Summary
					</span>
					<span className="block truncate text-foreground/40">
						Configured for your format
					</span>
				</span>
				<ChevronRight
					aria-hidden="true"
					className="size-3 text-foreground/25"
				/>
			</div>
			<div className="flex items-center gap-2 rounded-xl bg-white/60 px-2.5 py-2.5 text-[10px] dark:bg-white/[0.06]">
				<FileCheck2
					aria-hidden="true"
					className="size-3.5 shrink-0 text-emerald-600"
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-foreground/75">
						Claims preparation
					</span>
					<span className="block truncate text-foreground/40">
						Uses your approval steps
					</span>
				</span>
				<ChevronRight
					aria-hidden="true"
					className="size-3 text-foreground/25"
				/>
			</div>
			<div className="flex items-center gap-2 rounded-xl bg-white/60 px-2.5 py-2.5 text-[10px] dark:bg-white/[0.06]">
				<FileCheck2
					aria-hidden="true"
					className="size-3.5 shrink-0 text-emerald-600"
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-foreground/75">
						Invoice reconciliation
					</span>
					<span className="block truncate text-foreground/40">
						Connects your records
					</span>
				</span>
				<ChevronRight
					aria-hidden="true"
					className="size-3 text-foreground/25"
				/>
			</div>
		</div>
	);
}

function BotCardVisual() {
	return (
		<div className="space-y-3">
			<div className="ml-auto max-w-[88%] rounded-xl bg-white/65 px-3 py-2 text-[11px] text-foreground/60 dark:bg-white/[0.08]">
				Process the five policies that arrived today.
			</div>
			<div className="max-w-[92%] rounded-xl bg-white/55 px-3 py-3 text-[11px] text-foreground/75 leading-relaxed dark:bg-white/[0.06]">
				<p>Done. Five drafts are ready for review.</p>
				<div className="mt-3 flex flex-wrap gap-1.5">
					<span className="flex items-center gap-1.5 rounded-md bg-white/60 px-2 py-1 text-[10px] text-foreground/55 dark:bg-white/10">
						<FileCheck2 aria-hidden="true" className="size-3" /> Sources used
					</span>
					<span className="flex items-center gap-1.5 rounded-md bg-white/60 px-2 py-1 text-[10px] text-foreground/55 dark:bg-white/10">
						<Check aria-hidden="true" className="size-3" /> Ready to review
					</span>
				</div>
			</div>
		</div>
	);
}

function ConsoleCardVisual() {
	return (
		<div className="space-y-2.5">
			<div className="flex items-center justify-between rounded-xl bg-white/60 px-3 py-2.5 text-[10px] dark:bg-white/[0.06]">
				<span className="flex items-center gap-2 text-foreground/65">
					<Settings2
						aria-hidden="true"
						className="size-3.5 text-foreground/60"
					/>
					Change proposal
				</span>
				<span className="rounded-full bg-amber-100 px-2 py-1 font-medium text-[9px] text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
					Pending
				</span>
			</div>
			<div className="rounded-xl bg-white/55 p-3 text-[10px] leading-relaxed dark:bg-white/[0.05]">
				<div className="flex items-center justify-between gap-3 py-1">
					<span className="text-foreground/40">Workflow</span>
					<span className="text-right text-foreground/70">Policy Summary</span>
				</div>
				<div className="flex items-center justify-between gap-3 py-1">
					<span className="text-foreground/40">Approval</span>
					<span className="text-right text-foreground/70">
						Manager &gt; $5,000
					</span>
				</div>
				<div className="flex items-center justify-between gap-3 py-1">
					<span className="text-foreground/40">Audit record</span>
					<span className="text-right text-foreground/70">
						Will be captured
					</span>
				</div>
			</div>
		</div>
	);
}

const PRODUCT_SURFACE_CARDS: readonly ProductSurfaceCardData[] = [
	{
		description: "Ready-made applications for business workflows.",
		href: "/marketplace",
		icon: Workflow,
		id: "apps",
		label: "Ryu Apps",
		tone: "green",
		visual: <WorkflowCardVisual />,
	},
	{
		description: "Chat with Ryu through the Bot interface.",
		href: "/bot",
		icon: Bot,
		id: "bot",
		label: "Ryu Bot",
		tone: "teal",
		visual: <BotCardVisual />,
	},
	{
		description: "Configure Ryu from the control panel.",
		href: "/console",
		icon: Settings2,
		id: "console",
		label: "Ryu Console",
		tone: "pink",
		visual: <ConsoleCardVisual />,
	},
];

function ProductSurfaceCard({ card }: { card: ProductSurfaceCardData }) {
	const Icon = card.icon;
	const tone = LANDING_CARD_TONES[card.tone];

	return (
		<Link
			className={cn(
				"group flex min-h-[19rem] flex-col overflow-hidden transition-transform hover:-translate-y-0.5",
				landingCardSurfaceClass(card.tone)
			)}
			data-testid={`realm-card-${card.id}`}
			href={card.href as Route}
		>
			<div className={cn("flex items-center gap-2 text-sm", tone.title)}>
				<Icon aria-hidden="true" className="size-4" />
				<span>{card.label}</span>
			</div>
			<p className={cn("mt-2 max-w-xs text-xs leading-relaxed", tone.body)}>
				{card.description}
			</p>
			<div className="relative min-h-0 flex-1 overflow-hidden pt-5">
				<div className="transition-transform duration-500 ease-out group-hover:scale-[1.035]">
					{card.visual}
				</div>
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/10 via-black/0 to-transparent blur-[1px]"
				/>
			</div>
			<div
				className={cn(
					"flex items-center justify-between pt-5 text-xs",
					tone.ctaSecondary
				)}
			>
				<span>Explore</span>
				<HugeiconsIcon
					aria-hidden="true"
					className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
					icon={ArrowRight01Icon}
				/>
			</div>
		</Link>
	);
}

export function ProductSurfaceCards({ className }: { className?: string }) {
	return (
		<div className={cn("grid gap-3 md:grid-cols-3", className)}>
			{PRODUCT_SURFACE_CARDS.map((card) => (
				<ProductSurfaceCard card={card} key={card.id} />
			))}
		</div>
	);
}
