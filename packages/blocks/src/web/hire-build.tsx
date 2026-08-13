import { buttonVariants } from "@ryu/ui/components/button";
import { cn } from "@ryu/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Blocks, Check, UserRoundSearch } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { DEMO_HREF } from "./data/resources.tsx";
import { DOWNLOAD_CTA_HREF } from "./download-cta.ts";
import { DownloadMenu } from "./download-menu.tsx";
import type { LandingCardTone } from "./landing-card-tones.ts";
import {
	LANDING_CARD_TONES,
	landingCardSurfaceClass,
} from "./landing-card-tones.ts";
import { Reveal } from "./reveal.tsx";
import { SectionHeading } from "./sections.tsx";

interface PathCard {
	bullets: string[];
	ctaExternal?: boolean;
	ctaHref: string;
	ctaLabel: string;
	description: string;
	icon: LucideIcon;
	secondaryCtaExternal?: boolean;
	secondaryCtaHref?: string;
	secondaryCtaLabel?: string;
	title: string;
	tone: LandingCardTone;
}

const PATHS: PathCard[] = [
	{
		icon: UserRoundSearch,
		tone: "orange",
		title: "Start from a pack",
		description:
			"Pick the one shaped like your work. It arrives already knowing the documents, the steps and the checks that job involves.",
		bullets: [
			"Translation jobs, claims files, working paper prep, and more",
			"Your reviewers and approval steps built in from the start",
			"A spending ceiling and a full record already switched on",
			"Running on real work in days",
		],
		ctaHref: "/for",
		ctaLabel: "See the packs",
		secondaryCtaHref: DEMO_HREF,
		secondaryCtaExternal: true,
		secondaryCtaLabel: "Book a consultation",
	},
	{
		icon: Blocks,
		tone: "purple",
		title: "Or we shape one",
		description:
			"If your work does not look like anyone else's, we sit down with you and build the pack around it. Nothing for your team to configure.",
		bullets: [
			"We map the workflow with the people who do it today",
			"Your glossary, your templates, your house rules",
			"Corrections your reviewers make are kept and reused",
			"It stays yours to change as the work changes",
		],
		ctaHref: DEMO_HREF,
		ctaExternal: true,
		ctaLabel: "Talk it through",
		secondaryCtaHref: "/for",
		secondaryCtaLabel: "See what we cover",
	},
];

function PathCardBlock({ card }: { card: PathCard }) {
	const Icon = card.icon;
	const tone = LANDING_CARD_TONES[card.tone];
	const externalProps = {
		rel: "noopener noreferrer" as const,
		target: "_blank" as const,
	};
	const primaryProps = card.ctaExternal ? externalProps : {};
	const secondaryProps = card.secondaryCtaExternal ? externalProps : {};

	return (
		<div className={cn("flex flex-col", landingCardSurfaceClass(card.tone))}>
			<Icon className={cn("size-5", tone.title)} strokeWidth={1.75} />
			<h3
				className={cn("mt-6 font-medium text-3xl tracking-tight", tone.title)}
			>
				{card.title}
			</h3>
			<p className={cn("mt-3 leading-relaxed", tone.body)}>
				{card.description}
			</p>
			<ul className="mt-6 space-y-3">
				{card.bullets.map((point) => (
					<li className="flex items-start gap-3" key={point}>
						<Check className={cn("mt-0.5 size-4 shrink-0", tone.marker)} />
						<span className={cn("text-sm leading-relaxed", tone.bullet)}>
							{point}
						</span>
					</li>
				))}
			</ul>
			<div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
				{card.ctaHref === DOWNLOAD_CTA_HREF ? (
					<DownloadMenu
						className={cn("inline-flex items-center gap-1.5", tone.cta)}
						variant="outline"
					/>
				) : (
					<Link
						className={cn(
							buttonVariants({ variant: "outline" }),
							"inline-flex items-center gap-1.5",
							tone.cta
						)}
						href={card.ctaHref as Route}
						{...primaryProps}
					>
						{card.ctaLabel}
						<ArrowRight className="size-4" />
					</Link>
				)}
				{card.secondaryCtaHref && card.secondaryCtaLabel ? (
					<Link
						className={cn(
							buttonVariants({ variant: "ghost" }),
							"inline-flex",
							tone.ctaSecondary
						)}
						href={card.secondaryCtaHref as Route}
						{...secondaryProps}
					>
						{card.secondaryCtaLabel}
					</Link>
				) : null}
			</div>
		</div>
	);
}

export default function HireBuild() {
	return (
		<section className="container mx-auto px-4">
			<div className="mx-auto max-w-6xl">
				<SectionHeading
					subtitle="Nobody starts from a blank page. You pick the one shaped like your work, or we shape one around it."
					title="You never configure anything"
				/>
				<div className="grid gap-6 md:grid-cols-2">
					{PATHS.map((card, i) => (
						<Reveal delay={i * 0.08} key={card.title}>
							<PathCardBlock card={card} />
						</Reveal>
					))}
				</div>
			</div>
		</section>
	);
}
