import { buttonVariants } from "@ryu/ui/components/button";
import { cn } from "@ryu/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import { CalendarX, Clock4, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { DEMO_HREF } from "./data/resources.tsx";
import {
	LANDING_CARD_TONES,
	type LandingCardTone,
	landingCardSurfaceClass,
} from "./landing-card-tones.ts";
import { TEAMS_MIN_SEATS, TEAMS_MONTHLY_PER_SEAT_USD } from "./pricing.tsx";
import { Reveal } from "./reveal.tsx";
import { SectionTitle, sectionSubtitleClass } from "./sections.tsx";
import { StaggerLines } from "./stagger-lines.tsx";

/**
 * Cost is the binding constraint in the buyer's own language. Name the hidden
 * costs around an AI answer before showing the plan price.
 */
const ALTERNATIVES: {
	body: string;
	icon: LucideIcon;
	title: string;
	tone: LandingCardTone;
}[] = [
	{
		icon: UserRoundPlus,
		tone: "orange",
		title: "The checking tax",
		body: "If every answer needs a second pass, AI is adding work. Ryu keeps the source, review points, and record beside the output.",
	},
	{
		icon: CalendarX,
		tone: "purple",
		title: "The cost of copy-paste",
		body: "When AI cannot reach the right files and systems, someone becomes the bridge. Ryu connects approved context once, then keeps it in view.",
	},
	{
		icon: Clock4,
		tone: "teal",
		title: "The bill you cannot forecast",
		body: "Set the ceiling before the work starts, see the cost of each job, and stop usage from quietly becoming another line item.",
	},
];

export default function PriceVsHeadcount() {
	return (
		<section className="container mx-auto px-4 py-20 md:py-28">
			<div className="mx-auto max-w-5xl">
				<StaggerLines className="max-w-2xl">
					<SectionTitle title="Checking AI output is an operating cost." />
					<p className={sectionSubtitleClass}>
						The model call is only part of the cost. The rest is review, rework,
						and manual copy-paste.
					</p>
				</StaggerLines>

				<div className="mt-14 grid gap-6 md:grid-cols-3">
					{ALTERNATIVES.map((item, i) => {
						const Icon = item.icon;
						const tone = LANDING_CARD_TONES[item.tone];
						return (
							<Reveal delay={i * 0.08} key={item.title}>
								<div className={landingCardSurfaceClass(item.tone)}>
									<Icon
										aria-hidden="true"
										className={cn("size-5", tone.title)}
										strokeWidth={1.75}
									/>
									<h3
										className={cn(
											"mt-6 font-medium text-xl tracking-tight",
											tone.title
										)}
									>
										{item.title}
									</h3>
									<p className={cn("mt-3 text-sm leading-relaxed", tone.body)}>
										{item.body}
									</p>
								</div>
							</Reveal>
						);
					})}
				</div>

				<Reveal>
					<div className="mt-10 flex flex-col gap-6 rounded-2xl bg-muted/50 p-6 backdrop-blur-sm md:flex-row md:items-center md:justify-between md:p-8">
						<div>
							{/* The public plan price stays next to the control that makes the
							    buyer's total spend legible: a ceiling on top of the seat. */}
							<p className="font-medium text-3xl text-foreground tracking-tight md:text-4xl">
								<span className="mr-1 font-normal text-lg text-muted-foreground">
									From
								</span>
								${TEAMS_MONTHLY_PER_SEAT_USD}
								<span className="ml-1 font-normal text-lg text-muted-foreground">
									/seat · {TEAMS_MIN_SEATS}-seat minimum, per month
								</span>
							</p>
							<p className="mt-2 max-w-md text-muted-foreground text-sm leading-relaxed">
								A member-seat price with a spending ceiling on top of it. Start
								with the five-seat minimum, then expand when the first workflow
								is earning its place.
							</p>
						</div>
						<div className="flex shrink-0 flex-col gap-3 sm:flex-row">
							<Link
								className={cn(buttonVariants({ variant: "default" }))}
								href={DEMO_HREF}
								rel="noopener noreferrer"
								target="_blank"
							>
								Book a demo
							</Link>
							<Link
								className={cn(buttonVariants({ variant: "ghost" }))}
								href="/pricing"
							>
								See pricing
							</Link>
						</div>
					</div>
				</Reveal>
			</div>
		</section>
	);
}
