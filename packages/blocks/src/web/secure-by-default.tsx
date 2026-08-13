import { cn } from "@ryu/ui/lib/utils";
import { AlertTriangle, BadgeCheck, Check, ShieldCheck, X } from "lucide-react";
import {
	LANDING_CARD_TONES,
	landingCardSurfaceClass,
	landingMutedCardSurfaceClass,
} from "./landing-card-tones.ts";
import { Reveal } from "./reveal.tsx";
import { SectionTitle, sectionSubtitleClass } from "./sections.tsx";
import { StaggerLines } from "./stagger-lines.tsx";

/**
 * NOTE: this block deliberately does NOT render `GatewayMock`. That visual is
 * labelled "Ryu Gateway / Routing / PII / DLP / Tokens / Prompt injection" —
 * developer-motion vocabulary, correct on a developer surface and wrong on the
 * business front door, which is the only page this block appears on.
 *
 * The sign-off contrast, written for the partner who has to answer the client —
 * so the language here is deliberately plain. "Audit", "governance" and
 * "observability" are the words that lose this reader; "we show you exactly
 * what it did" is the same claim they will actually act on.
 */

const RISKS = [
	"No record of what was done, or who said yes to it",
	"Client names and numbers get sent outside the firm",
	"No spending ceiling, so nobody can promise what next month costs",
	"Keeping it all running turns into somebody's second job",
] as const;

const DEFENSES = [
	"Every step written down in order, readable by a partner",
	"Client names and numbers cannot get sent out",
	"A spending ceiling per person and per team, enforced as work runs",
	"Anything risky waits for a person to say yes",
] as const;

function RiskCard() {
	return (
		<div className={landingMutedCardSurfaceClass}>
			<AlertTriangle className="size-5 text-foreground" strokeWidth={1.75} />
			<p className="mt-6 font-semibold text-muted-foreground/60 text-xs uppercase tracking-widest">
				Why it never ships
			</p>
			<h3 className="mt-2 font-medium text-foreground text-xl tracking-tight md:text-2xl">
				It works, and still nobody will sign off
			</h3>
			<ul className="mt-6 space-y-3">
				{RISKS.map((risk) => (
					<li className="flex items-start gap-3" key={risk}>
						<X
							aria-hidden="true"
							className="mt-0.5 size-4 shrink-0 text-muted-foreground/70"
							strokeWidth={1.5}
						/>
						<span className="text-foreground/80 text-sm leading-relaxed">
							{risk}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function DefenseCard() {
	const tone = LANDING_CARD_TONES.green;
	return (
		<div className={landingCardSurfaceClass("green")}>
			<ShieldCheck className={cn("size-5", tone.title)} strokeWidth={1.75} />
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
				You can answer the client
			</h3>
			<ul className="mt-6 space-y-3">
				{DEFENSES.map((defense) => (
					<li className="flex items-start gap-3" key={defense}>
						<Check
							aria-hidden="true"
							className={cn("mt-0.5 size-4 shrink-0", tone.marker)}
							strokeWidth={1.5}
						/>
						<span className={cn("text-sm leading-relaxed", tone.bullet)}>
							{defense}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

export default function SecureByDefault() {
	return (
		<section className="container mx-auto px-4 py-20 md:py-28">
			<div className="mx-auto max-w-5xl">
				<StaggerLines className="max-w-2xl">
					<SectionTitle title="We show you exactly what it did" />
					<p className={sectionSubtitleClass}>
						You can see what it did step by step, you set the monthly limit, and
						your people approve anything that matters.
					</p>
				</StaggerLines>

				<div className="mt-14 grid gap-6 md:grid-cols-2">
					<Reveal>
						<RiskCard />
					</Reveal>
					<Reveal delay={0.08}>
						<DefenseCard />
					</Reveal>
				</div>

				<p className="mt-10 flex max-w-xl items-center gap-2 font-medium text-muted-foreground text-sm md:text-base">
					<BadgeCheck
						aria-hidden="true"
						className="size-4 shrink-0 text-muted-foreground"
						strokeWidth={1.5}
					/>
					Every job leaves a record you can hand to a client.
				</p>
			</div>
		</section>
	);
}
