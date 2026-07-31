import { cn } from "@ryu/ui/lib/utils";
import { AlertTriangle, BadgeCheck, Check, ShieldCheck, X } from "lucide-react";
import { GatewayMock } from "./gateway-showcase.tsx";
import {
	LANDING_CARD_TONES,
	landingCardSurfaceClass,
	landingMutedCardSurfaceClass,
} from "./landing-card-tones.ts";
import { Reveal } from "./reveal.tsx";
import { SectionTitle, sectionSubtitleClass } from "./sections.tsx";

/**
 * The risk contrast: an agent can work in a demo and still lack the controls
 * required for production. Styled like the rest of the landing page.
 */

const RISKS = [
	"No record of what the agent did or who approved it",
	"Customer data leaves for an outside provider on every call",
	"No budget ceiling means next month's bill is unknown",
	"Keeping the runtime alive becomes a platform team's full-time job",
] as const;

const DEFENSES = [
	"Every call, tool use, and approval recorded in order",
	"PII redacted before a request leaves for an outside provider",
	"Per-agent and per-team budget ceilings enforced at request time",
	"Writes and risky tool calls can wait for human approval",
] as const;

function RiskCard() {
	return (
		<div className={landingMutedCardSurfaceClass}>
			<AlertTriangle className="size-5 text-foreground" strokeWidth={1.75} />
			<p className="mt-6 font-semibold text-muted-foreground/60 text-xs uppercase tracking-widest">
				What stops production
			</p>
			<h3 className="mt-2 font-medium text-foreground text-xl tracking-tight md:text-2xl">
				The agent works, but nobody can sign off
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
				Governed by default
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
				<div className="max-w-2xl">
					<SectionTitle title="Governance is the deal" />
					<p className={sectionSubtitleClass}>
						Ryu puts audit, redaction, budgets, and approvals in the path of
						every call.
					</p>
				</div>

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
					The control layer that makes a real deployment possible.
				</p>

				<div className="mt-16 md:mt-20">
					<div className="max-w-2xl">
						<SectionTitle title="One gateway in front of every agent" />
						<p className={sectionSubtitleClass}>
							Routing, firewall, PII/DLP, budgets, and audit sit between your
							agents and the model providers.
						</p>
					</div>
					<Reveal>
						<div className="mx-auto mt-10 max-w-3xl">
							<GatewayMock />
						</div>
					</Reveal>
				</div>
			</div>
		</section>
	);
}
