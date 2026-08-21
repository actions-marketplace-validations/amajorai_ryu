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
 * The pricing objection is not the number, it is the comparison the buyer makes
 * in their head. Left alone they compare us to a chat subscription and we lose.
 * This section names the three alternatives they are actually choosing between:
 * a hire, a job they refused, and overtime.
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
		title: "The capacity you need before another hire",
		body: "A Ryu agent owns one repeatable business process, with your rules and review points built in. Add capacity without adding another person to train.",
	},
	{
		icon: CalendarX,
		tone: "purple",
		title: "The job you turned down last quarter",
		body: "Work you refused because the team was full, or because the file was too sensitive to hand to anyone with spare capacity.",
	},
	{
		icon: Clock4,
		tone: "teal",
		title: "The overtime you paid to clear the backlog",
		body: "The weekends your team gave up the last time the deadline and the volume landed in the same week.",
	},
];

export default function PriceVsHeadcount() {
	return (
		<section className="container mx-auto px-4 py-20 md:py-28">
			<div className="mx-auto max-w-5xl">
				<StaggerLines className="max-w-2xl">
					<SectionTitle title="Compare us to the loaded cost of the hire, not to a chat subscription." />
					<p className={sectionSubtitleClass}>
						Anchor on the salary, benefits, management hours, and backlog you
						would carry to add capacity. You are buying the work getting done,
						and a record you can show a client.
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
							{/* "From": this is the per-seat list price, while the section
							    above sells a workflow we configure for the firm. Printing a
							    bare number beside a configured deployment prices the wrong
							    product, and the prospect finds the gap on the call. */}
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
								with the five-seat minimum, then expand only when the hours and
								dollars justify it.
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
