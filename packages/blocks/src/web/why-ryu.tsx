import { buttonVariants } from "@ryu/ui/components/button";
import { cn } from "@ryu/ui/lib/utils";
import Link from "next/link";
import { landingSurfaceCardXlClass } from "./landing-card-tones.ts";
import { Reveal } from "./reveal.tsx";
import { SectionTitle, sectionSubtitleClass } from "./sections.tsx";
import { StaggerLines } from "./stagger-lines.tsx";

const steps = [
	{
		title: "We start with the job, not the software.",
		body: "A free session where we look at one workflow your team is drowning in, and say plainly whether we can take it off them.",
	},
	{
		title: "We set it up around your firm.",
		body: "Your document types, your rules, your glossary, your approval steps. Days of configuration, not months of training a model on your data.",
	},
	{
		title: "You see every action and every cost.",
		body: "A plain record a partner can read, and a monthly ceiling you set. This is what makes sign-off possible instead of a leap of faith.",
	},
	{
		title: "Then you add the next workflow.",
		body: "Every rule and correction your team captures stays. The second workflow is faster than the first, and the tenth is faster still.",
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
						<SectionTitle title="How we actually work with you." />
						<p className={sectionSubtitleClass}>
							One workflow at a time, priced monthly, with the record and the
							ceiling in place from day one.
						</p>
					</StaggerLines>
					<div className="mt-8 flex flex-col gap-3 sm:flex-row">
						<Link
							className={cn(buttonVariants({ variant: "default" }))}
							href="https://cal.com/jiaweing/ryu-demo"
							rel="noopener noreferrer"
							target="_blank"
						>
							Book a free consultation
						</Link>
						<Link
							className={cn(buttonVariants({ variant: "ghost" }))}
							href="/for"
						>
							See what we automate
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
