import { cn } from "@ryu/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import { HardDrive, ScrollText, Wallet } from "lucide-react";
import { Reveal } from "./reveal.tsx";

/**
 * The PROOF beat: the three facts that answer "I cannot send client files to an
 * AI". It runs after the objection has been named, never before it.
 *
 * Every line is written from the reader's side, not ours. "We run on your
 * machines" is a fact about how we built it; "your files never leave your
 * office" is the same fact about their world, which is the one they act on.
 * Keep the grammatical subject as the buyer.
 */
const POINTS: { detail: string; icon: LucideIcon; label: string }[] = [
	{
		icon: HardDrive,
		label: "Your files never leave your office",
		detail: "The work runs on your own computers, not somewhere else.",
	},
	{
		icon: ScrollText,
		label: "You can see exactly what it did",
		detail: "Step by step, in plain words a partner can read.",
	},
	{
		icon: Wallet,
		label: "You set a monthly limit",
		detail: "It cannot go over. You know the bill before the work starts.",
	},
];

export default function TrustStrip() {
	return (
		<section className="container mx-auto px-4 pt-8 md:pt-12">
			<div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-3">
				{POINTS.map((point, i) => {
					const Icon = point.icon;
					return (
						<Reveal delay={(i % 3) * 0.06} key={point.label}>
							<div
								className={cn(
									"flex h-full flex-col gap-2 rounded-2xl bg-muted/50 p-4 backdrop-blur-sm",
									"transition-colors duration-200 hover:bg-muted/70"
								)}
							>
								<Icon
									aria-hidden="true"
									className="size-5 text-foreground"
									strokeWidth={1.75}
								/>
								<p className="font-semibold text-foreground text-sm">
									{point.label}
								</p>
								<p className="text-muted-foreground text-sm leading-relaxed">
									{point.detail}
								</p>
							</div>
						</Reveal>
					);
				})}
			</div>
		</section>
	);
}
