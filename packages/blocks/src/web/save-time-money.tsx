import { cn } from "@ryu/ui/lib/utils";
import { Check, Clock, Wallet } from "lucide-react";
import {
	LANDING_CARD_TONES,
	type LandingCardTone,
	landingCardSurfaceClass,
} from "./landing-card-tones.ts";
import { Reveal } from "./reveal.tsx";
import { SectionTitle } from "./sections.tsx";

interface Column {
	body: string;
	eyebrow: string;
	icon: typeof Clock;
	points: string[];
	title: string;
	tone: LandingCardTone;
}

const COLUMNS: Column[] = [
	{
		icon: Clock,
		tone: "yellow",
		eyebrow: "Take back the hours",
		title: "Your team stops doing the paperwork.",
		body: "The document work that fills the day gets done in the background, with your people reviewing instead of typing.",
		points: [
			"Set up around your document types and your rules",
			"Your reviewers stay in the loop where it counts",
			"Ready in days, not a six month project",
			"We build the first workflow with you, not for you to figure out",
		],
	},
	{
		icon: Wallet,
		tone: "teal",
		eyebrow: "Know the bill first",
		title: "Cost is a setting, not a surprise.",
		body: "You set the ceiling. Routine work runs on your own machines at no per-job cost, and the expensive models get used only when the job earns it.",
		points: [
			"A monthly ceiling per person and per team",
			"See what a job cost before you quote the client",
			"Routine work runs on your machines instead of billing per request",
			"Keep the subscriptions you already pay for",
		],
	},
];

export default function SaveTimeMoney() {
	return (
		<section className="container mx-auto px-4 py-20 md:py-28">
			<div className="mx-auto max-w-5xl">
				<div className="max-w-2xl">
					<SectionTitle
						suffix={
							<span className="text-muted-foreground">
								{" "}
								You get the work done and the receipts, not another project.
							</span>
						}
						title="You are buying output, not software."
					/>
				</div>

				<div className="mt-14 grid gap-6 md:grid-cols-2">
					{COLUMNS.map((column, i) => {
						const Icon = column.icon;
						const tone = LANDING_CARD_TONES[column.tone];
						return (
							<Reveal delay={i * 0.08} key={column.eyebrow}>
								<div className={landingCardSurfaceClass(column.tone)}>
									<Icon
										className={cn("size-5", tone.title)}
										strokeWidth={1.75}
									/>
									<p
										className={cn(
											"mt-6 font-semibold text-xs uppercase tracking-widest",
											tone.eyebrow
										)}
									>
										{column.eyebrow}
									</p>
									<h3
										className={cn(
											"mt-2 font-medium text-xl tracking-tight md:text-2xl",
											tone.title
										)}
									>
										{column.title}
									</h3>
									<p className={cn("mt-3 leading-relaxed", tone.body)}>
										{column.body}
									</p>
									<ul className="mt-6 space-y-3">
										{column.points.map((point) => (
											<li className="flex items-start gap-3" key={point}>
												<Check
													className={cn("mt-0.5 size-4 shrink-0", tone.marker)}
												/>
												<span
													className={cn("text-sm leading-relaxed", tone.bullet)}
												>
													{point}
												</span>
											</li>
										))}
									</ul>
								</div>
							</Reveal>
						);
					})}
				</div>
			</div>
		</section>
	);
}
