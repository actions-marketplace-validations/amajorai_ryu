import { cn } from "@ryu/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import { HardDrive, ScrollText, Wallet } from "lucide-react";
import { Reveal } from "./reveal.tsx";

/**
 * The three sentences a partner needs before they will read anything else on
 * the page. Deliberately plain language: this sits directly under the hero and
 * is read by the person who has to sign off on client work, not by an engineer.
 */
const POINTS: { detail: string; icon: LucideIcon; label: string }[] = [
	{
		icon: HardDrive,
		label: "We run on your machines",
		detail: "Client files stay inside the firm unless you say otherwise.",
	},
	{
		icon: ScrollText,
		label: "We log every action",
		detail: "A plain record of what was done, readable by a partner.",
	},
	{
		icon: Wallet,
		label: "We cap your monthly cost",
		detail: "A ceiling you set. You know the bill before the work starts.",
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
