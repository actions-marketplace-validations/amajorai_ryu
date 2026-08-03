import { buttonVariants } from "@ryu/ui/components/button";
import { cn } from "@ryu/ui/lib/utils";
import Link from "next/link";
import { landingSurfaceCardXlClass } from "./landing-card-tones.ts";
import { Reveal } from "./reveal.tsx";
import { SectionTitle, sectionSubtitleClass } from "./sections.tsx";
import { StaggerLines } from "./stagger-lines.tsx";

const steps = [
	{
		title: "The hard part is not the model.",
		body: "The work needs tools, memory, policies, approvals, retries, and a record of what happened. Most teams have to assemble that layer by hand.",
	},
	{
		title: "Ryu owns the control layer.",
		body: "Local models handle routine work. Frontier models handle the jobs that need them. Routing, budgets, redaction, tools, and audit live in one place.",
	},
	{
		title: "Your team gets agents, not another infra project.",
		body: "Install an agent for a real workflow, connect the tools your team already uses, and keep humans in the loop where work needs review.",
	},
	{
		title: "Start narrow. Expand on the same core.",
		body: "Map one workflow, set its policy, and add more agents as the platform proves itself. Each rollout hardens the same control layer instead of creating another silo.",
	},
];

export default function WhyRyu() {
	return (
		<section className="container mx-auto px-4 py-20 md:py-28">
			<div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-2 lg:gap-16">
				{/* Left, pinned statement */}
				<div className="lg:sticky lg:top-28 lg:self-start">
					{/* Wraps only the title and its supporting line: the button row below
					    is a flex layout and `.t-stagger-line` would force it to block. */}
					<StaggerLines>
						<SectionTitle title="The layer that gets agents into production." />
						<p className={sectionSubtitleClass}>
							One interface and one control layer for every agent a company
							runs.
						</p>
					</StaggerLines>
					<div className="mt-8 flex flex-col gap-3 sm:flex-row">
						<Link
							className={cn(buttonVariants({ variant: "default" }))}
							href="https://cal.com/jiaweing/ryu-demo"
							rel="noopener noreferrer"
							target="_blank"
						>
							Book a Demo
						</Link>
						<Link
							className={cn(buttonVariants({ variant: "ghost" }))}
							href="/for"
						>
							See workflows
						</Link>
					</div>
				</div>

				{/* Right, numbered steps that scroll past the pinned left */}
				<div className="space-y-4 lg:space-y-6">
					{steps.map((step, i) => (
						<Reveal delay={(i % 2) * 0.08} key={step.title}>
							<div className={landingSurfaceCardXlClass}>
								<span className="font-medium text-muted-foreground/50 text-sm">
									{String(i + 1).padStart(2, "0")}
								</span>
								<h3 className="mt-3 font-medium text-foreground text-xl tracking-tight">
									{step.title}
								</h3>
								<p className="mt-2 text-muted-foreground leading-relaxed">
									{step.body}
								</p>
							</div>
						</Reveal>
					))}
				</div>
			</div>
		</section>
	);
}
