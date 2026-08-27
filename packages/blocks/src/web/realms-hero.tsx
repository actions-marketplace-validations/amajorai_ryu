"use client";

import { buttonVariants } from "@ryu/ui/components/button";
import { ChromaticTextReveal } from "@ryu/ui/components/motion/chromatic-text-reveal";
import PageHeader from "@ryu/ui/components/page-header";
import { cn } from "@ryu/ui/lib/utils";
import {
	ArrowRight,
	Bot,
	Cloud,
	type LucideIcon,
	Plug,
	Settings2,
	Timer,
	UsersRound,
	Workflow,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { DownloadMenu } from "./download-menu.tsx";
import HeroWorkflowLoop, {
	HeroUseCaseSwitcher,
} from "./hero-workflow-loop.tsx";
import type { LandingCardTone } from "./landing-card-tones.ts";
import {
	LANDING_CARD_TONES,
	landingCardSurfaceClass,
} from "./landing-card-tones.ts";
import { landingHeadlineClass } from "./landing-typography.ts";
import ProductLandingCtas from "./product-landing-ctas.tsx";
import { ProductRealmSelector } from "./product-realm-selector.tsx";
import { Reveal } from "./reveal.tsx";

interface PitchCardData {
	description: string;
	icon: LucideIcon;
	title: string;
	tone: LandingCardTone;
}

const POSITIONING_CARDS: PitchCardData[] = [
	{
		description: "Fewer than 10 employees.",
		icon: UsersRound,
		title: "Pre-seed to seed startups",
		tone: "blue",
	},
	{
		description: "Run autonomous AI safely in the cloud.",
		icon: Cloud,
		title: "Autonomous AI in the cloud",
		tone: "purple",
	},
	{
		description:
			"Get the first agent running without building the platform first.",
		icon: Timer,
		title: "Start in a few minutes",
		tone: "yellow",
	},
];

const DELIVERY_CARDS: PitchCardData[] = [
	{
		description: "Ryu handles cloud deployment and runtime operations.",
		icon: Cloud,
		title: "We deploy and keep it running.",
		tone: "orange",
	},
	{
		description: "Connect the tools the team already uses.",
		icon: Plug,
		title: "We provide a simple toolkit.",
		tone: "teal",
	},
];

const TOOLKIT_SURFACES = [
	{
		action: "View Bot",
		description: "Chat with Ryu through the Bot interface.",
		href: "/bot",
		icon: Bot,
		id: "bot",
		label: "Bot",
		tone: "teal",
	},
	{
		action: "View Console",
		description: "Configure Ryu from the control panel.",
		href: "/console",
		icon: Settings2,
		id: "console",
		label: "Console",
		tone: "pink",
	},
	{
		action: "View Apps",
		description: "Use ready-made applications for business workflows.",
		href: "/marketplace",
		icon: Workflow,
		id: "apps",
		label: "Apps",
		tone: "green",
	},
] as const;

function PitchCard({ card }: { card: PitchCardData }) {
	const Icon = card.icon;
	const tone = LANDING_CARD_TONES[card.tone];

	return (
		<div
			className={cn(
				"flex min-h-52 flex-col",
				landingCardSurfaceClass(card.tone)
			)}
		>
			<Icon
				aria-hidden="true"
				className={cn("size-5", tone.title)}
				strokeWidth={1.75}
			/>
			<h3
				className={cn("mt-6 font-medium text-2xl tracking-tight", tone.title)}
			>
				{card.title}
			</h3>
			<p className={cn("mt-3 leading-relaxed", tone.body)}>
				{card.description}
			</p>
		</div>
	);
}

function PositioningSection() {
	return (
		<section
			aria-labelledby="positioning-heading"
			className="border-muted border-t"
			data-testid="positioning-section"
			id="positioning"
		>
			<div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
				<h2
					className="max-w-3xl text-balance font-medium text-4xl text-foreground leading-tight tracking-[-0.04em] md:text-5xl"
					id="positioning-heading"
				>
					Ryu is an AI deployment platform.
				</h2>
				<p className="mt-5 max-w-2xl text-lg text-muted-foreground leading-relaxed">
					Ryu helps pre-seed to seed startups with fewer than 10 employees run
					autonomous AI safely in the cloud.
				</p>

				<div className="mt-10 grid gap-4 md:grid-cols-3">
					{POSITIONING_CARDS.map((card, index) => (
						<Reveal delay={index * 0.08} key={card.title}>
							<PitchCard card={card} />
						</Reveal>
					))}
				</div>
			</div>
		</section>
	);
}

export default function RealmsHero() {
	const [scenarioIndex, setScenarioIndex] = useState(0);

	return (
		<main className="bg-background text-foreground" data-testid="realms-hero">
			<section className="mx-auto max-w-6xl px-6 pt-16 pb-20 md:pt-24 md:pb-24">
				<div className="max-w-2xl">
					<PageHeader
						className="max-w-xl"
						title={
							<>
								We deploy and run autonomous AI
								<br />
								<ChromaticTextReveal
									delay={0.3}
									loop={false}
									once
									prefix="safely in the"
									startOnView
									words={["cloud"]}
								/>
							</>
						}
						titleClassName={landingHeadlineClass}
					/>

					<div className="mt-8 flex flex-col gap-3 sm:flex-row">
						<DownloadMenu
							label="Download"
							separatorClassName="bg-primary-foreground/10 data-vertical:mx-0"
							size="default"
						/>
						<Link
							className={cn(
								buttonVariants({ variant: "ghost" }),
								"rounded-full"
							)}
							href="/help"
						>
							Documentation
						</Link>
					</div>
				</div>

				<div className="mx-auto mt-16 max-w-5xl">
					<HeroUseCaseSwitcher
						current={scenarioIndex}
						onPick={setScenarioIndex}
					/>
					<div className="relative mt-4 flex min-h-[28rem] items-center justify-center overflow-hidden rounded-2xl px-4 py-6 md:min-h-[34rem] md:px-8 md:py-10">
						<div
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 bg-[url('/background.png')] bg-center bg-cover opacity-80"
						/>
						<div className="relative z-10 w-full max-w-6xl py-4 md:py-6">
							<HeroWorkflowLoop
								onScenarioChange={setScenarioIndex}
								scenarioIndex={scenarioIndex}
							/>
						</div>
					</div>
				</div>

				<div className="mx-auto mt-12 max-w-5xl">
					<ProductRealmSelector />
				</div>

				<div className="mt-14 grid gap-3 border-muted border-t pt-6 text-sm sm:grid-cols-3">
					<div className="flex gap-3">
						<UsersRound
							aria-hidden="true"
							className="mt-0.5 size-4 shrink-0 text-emerald-600"
						/>
						<div>
							<p className="font-medium text-foreground/80">Customer</p>
							<p className="mt-1 text-muted-foreground text-xs leading-relaxed">
								Pre-seed to seed startups with fewer than 10 employees.
							</p>
						</div>
					</div>
					<div className="flex gap-3">
						<Timer
							aria-hidden="true"
							className="mt-0.5 size-4 shrink-0 text-[#8f7bf2]"
						/>
						<div>
							<p className="font-medium text-foreground/80">Time to value</p>
							<p className="mt-1 text-muted-foreground text-xs leading-relaxed">
								A few minutes to get started.
							</p>
						</div>
					</div>
					<div className="flex gap-3">
						<Cloud
							aria-hidden="true"
							className="mt-0.5 size-4 shrink-0 text-[#d97706]"
						/>
						<div>
							<p className="font-medium text-foreground/80">Delivery</p>
							<p className="mt-1 text-muted-foreground text-xs leading-relaxed">
								We deploy and keep it running.
							</p>
						</div>
					</div>
				</div>
			</section>

			<PositioningSection />

			<section
				aria-labelledby="delivery-heading"
				className="border-muted border-t bg-muted/20"
				data-testid="delivery-section"
				id="how-it-works"
			>
				<div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
					<h2
						className="max-w-3xl text-balance font-medium text-4xl text-foreground leading-tight tracking-[-0.04em] md:text-5xl"
						id="delivery-heading"
					>
						No need to build from scratch or maintain it themselves.
					</h2>
					<p className="mt-5 max-w-2xl text-lg text-muted-foreground leading-relaxed">
						It takes only a few minutes. Ryu deploys the platform and keeps it
						running.
					</p>

					<div className="mt-10 grid gap-4 md:grid-cols-2">
						{DELIVERY_CARDS.map((card, index) => (
							<Reveal delay={index * 0.08} key={card.title}>
								<PitchCard card={card} />
							</Reveal>
						))}
					</div>
				</div>
			</section>

			<section
				aria-labelledby="toolkit-heading"
				className="border-muted border-t"
				data-testid="toolkit-section"
				id="toolkit"
			>
				<div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
					<h2
						className="max-w-3xl text-balance font-medium text-4xl text-foreground leading-tight tracking-[-0.04em] md:text-5xl"
						id="toolkit-heading"
					>
						A simple toolkit that connects the tools they already use.
					</h2>
					<p className="mt-5 max-w-2xl text-lg text-muted-foreground leading-relaxed">
						Use the same deployment through Apps, Bot, and Console.
					</p>

					<ul className="mt-10 grid gap-4 md:grid-cols-3">
						{TOOLKIT_SURFACES.map((surface) => {
							const Icon = surface.icon;
							const tone = LANDING_CARD_TONES[surface.tone];
							return (
								<li
									data-testid={`toolkit-surface-${surface.id}`}
									key={surface.id}
								>
									<Link
										className={cn(
											"group flex min-h-56 flex-col transition-transform hover:-translate-y-0.5",
											landingCardSurfaceClass(surface.tone)
										)}
										href={surface.href as Route}
									>
										<Icon
											aria-hidden="true"
											className={cn("size-5", tone.title)}
											strokeWidth={1.75}
										/>
										<h3
											className={cn(
												"mt-6 font-medium text-2xl tracking-tight",
												tone.title
											)}
										>
											{surface.label}
										</h3>
										<p className={cn("mt-3 leading-relaxed", tone.body)}>
											{surface.description}
										</p>
										<span
											className={cn(
												"mt-auto inline-flex items-center gap-1.5 pt-8 font-medium text-sm",
												tone.ctaSecondary
											)}
										>
											{surface.action}
											<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
										</span>
									</Link>
								</li>
							);
						})}
					</ul>
				</div>
			</section>

			<section
				aria-labelledby="start-heading"
				className="border-muted border-t"
				data-testid="start-section"
			>
				<div className="mx-auto flex max-w-6xl flex-col items-center px-6 py-20 text-center md:py-28">
					<h2
						className="max-w-2xl text-balance font-medium text-3xl text-foreground leading-tight tracking-[-0.04em] md:text-5xl"
						id="start-heading"
					>
						Run autonomous AI safely in the cloud.
					</h2>
					<p className="mt-5 max-w-xl text-muted-foreground leading-relaxed">
						Ryu deploys it, connects your tools, and keeps it running.
					</p>
					<ProductLandingCtas className="mt-8" />
				</div>
			</section>
		</main>
	);
}
