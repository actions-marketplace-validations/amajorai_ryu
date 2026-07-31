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
		eyebrow: "Save time",
		title: "Skip the platform-team project.",
		body: "Bring an agent or install one from the catalog. The control layer around it is ready instead of becoming another internal project.",
		points: [
			"Agents, tools, and skills without weeks of glue code",
			"Sessions, memory, workflows, and audit in one layer",
			"Ready-made agents for real workflows instead of a blank prompt",
			"Rollout support when your team wants help",
		],
	},
	{
		icon: Wallet,
		tone: "teal",
		eyebrow: "Save money",
		title: "Make the bill a setting, not a surprise.",
		body: "Routine work runs local and free. A frontier model gets called only when the task earns it, with a ceiling on every agent and team.",
		points: [
			"Route simple work away from premium cloud models",
			"Per-agent and per-team budgets with visible spend",
			"One control layer instead of separate infrastructure projects",
			"Bring your own keys and subscriptions with no lock-in",
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
								Ryu turns the missing layer into a product.
							</span>
						}
						title="Run agents without hiring the platform team."
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
