import { cn } from "@ryu/ui/lib/utils";
import { Check, FileClock, Users } from "lucide-react";
import {
	LANDING_CARD_TONES,
	landingCardSurfaceClass,
	landingMutedCardSurfaceClass,
} from "./landing-card-tones.ts";
import { Reveal } from "./reveal.tsx";
import { SectionTitle, sectionSubtitleClass } from "./sections.tsx";
import { StaggerLines } from "./stagger-lines.tsx";

/**
 * The sub-problem firms feel but do not name: the rules move, and nobody is
 * told. Framed as a problem the firm ALREADY has with its own staff — not one
 * that AI introduced — because that framing disarms the "AI is risky" objection
 * instead of arguing with it.
 */
const DRIFT = [
	{
		title: "The rules keep changing",
		body: "Client confidentiality terms, regulator guidance and your own procedures all move on their own schedule.",
	},
	{
		title: "They live in different places",
		body: "An email thread, a PDF, the shared drive, a chat group, and one partner's memory.",
	},
	{
		title: "People are already working off stale rules",
		body: "Not an AI problem. Staff find out the rule changed when something goes wrong.",
	},
	{
		title: "Nothing adds up over time",
		body: "When one person learns the rule changed, that knowledge leaves with them.",
	},
] as const;

const FIXES = [
	"One current copy of how your firm does the work",
	"Every change kept, so you can see what was true on the day a job ran",
	"A correction someone makes today is what the work follows tomorrow",
	"One copy, whether a person or the software does the job",
] as const;

function VersionStack() {
	return (
		<div className="mt-6 space-y-2">
			{[
				{ label: "Current", note: "in force now", active: true },
				{ label: "Previous", note: "what last quarter ran on", active: false },
				{ label: "Before that", note: "kept, not deleted", active: false },
			].map((row) => (
				<div
					className={cn(
						"flex items-center justify-between rounded-lg px-3 py-2 text-xs",
						row.active
							? "bg-foreground/10 text-foreground"
							: "bg-foreground/5 text-foreground/50"
					)}
					key={row.label}
				>
					<span className="font-medium">{row.label}</span>
					<span>{row.note}</span>
				</div>
			))}
		</div>
	);
}

export default function PolicyDrift() {
	const tone = LANDING_CARD_TONES.blue;

	return (
		<section className="container mx-auto px-4 py-20 md:py-28">
			<div className="mx-auto max-w-5xl">
				<StaggerLines className="max-w-2xl">
					<SectionTitle title="Set it up right today, out of policy by March." />
					<p className={sectionSubtitleClass}>
						Your rules move whether or not anyone writes them down. That is
						already true of your team. It quietly makes the work wrong.
					</p>
				</StaggerLines>

				<div className="mt-14 grid gap-6 md:grid-cols-2">
					<Reveal>
						<div className={landingMutedCardSurfaceClass}>
							<FileClock
								aria-hidden="true"
								className="size-5 text-foreground"
								strokeWidth={1.75}
							/>
							<p className="mt-6 font-semibold text-muted-foreground/60 text-xs uppercase tracking-widest">
								How it happens
							</p>
							<h3 className="mt-2 font-medium text-foreground text-xl tracking-tight md:text-2xl">
								Nobody holds the whole picture
							</h3>
							<ul className="mt-6 space-y-4">
								{DRIFT.map((item) => (
									<li key={item.title}>
										<p className="font-medium text-foreground/90 text-sm">
											{item.title}
										</p>
										<p className="mt-0.5 text-muted-foreground text-sm leading-relaxed">
											{item.body}
										</p>
									</li>
								))}
							</ul>
						</div>
					</Reveal>

					<Reveal delay={0.08}>
						<div className={landingCardSurfaceClass("blue")}>
							<Users
								aria-hidden="true"
								className={cn("size-5", tone.title)}
								strokeWidth={1.75}
							/>
							<p
								className={cn(
									"mt-6 font-semibold text-xs uppercase tracking-widest",
									tone.eyebrow
								)}
							>
								With Ryu
							</p>
							<h3
								className={cn(
									"mt-2 font-medium text-xl tracking-tight md:text-2xl",
									tone.title
								)}
							>
								One copy everyone works from
							</h3>
							<ul className="mt-6 space-y-3">
								{FIXES.map((fix) => (
									<li className="flex items-start gap-3" key={fix}>
										<Check
											aria-hidden="true"
											className={cn("mt-0.5 size-4 shrink-0", tone.marker)}
											strokeWidth={1.5}
										/>
										<span
											className={cn("text-sm leading-relaxed", tone.bullet)}
										>
											{fix}
										</span>
									</li>
								))}
							</ul>
							<VersionStack />
						</div>
					</Reveal>
				</div>

				<p className="mt-10 max-w-2xl text-muted-foreground text-sm leading-relaxed md:text-base">
					Every correction your team makes is kept, so the work gets more
					accurate the longer you run it.
				</p>
			</div>
		</section>
	);
}
