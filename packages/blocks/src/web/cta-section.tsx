"use client";

import { buttonVariants } from "@ryu/ui/components/button";
import { cn } from "@ryu/ui/lib/utils";
import { DEMO_HREF } from "./data/resources.tsx";
import { DownloadMenu } from "./download-menu.tsx";
import { landingSubheadlineClass } from "./landing-typography.ts";
import { SectionTitle } from "./section-title.tsx";
import { StaggerLines } from "./stagger-lines.tsx";

/**
 * Six other pages close with this block (`/products`, `/compare`, `/for`,
 * `/benchmark`, `/subscriptions`, `/community`), so the DEFAULT copy has to
 * read correctly on all of them. The landing page's own pitch — the paperwork,
 * the funding — is passed in as props rather than baked in here, or it leaks
 * onto pages where it makes no sense.
 */
export default function CtaSection({
	primaryHref = DEMO_HREF,
	primaryLabel = "Book a free consultation",
	title = "Put the work your team hates on autopilot.",
	subtitle = "Every action logged, every cost capped. Bring the tools you already pay for, or start with one we set up for you.",
}: {
	primaryHref?: string;
	primaryLabel?: string;
	subtitle?: string;
	title?: string;
} = {}) {
	return (
		<section className="container mx-auto px-4 py-24">
			<div className="mx-auto max-w-2xl text-center">
				{/* Wraps only the title and its supporting line: the button row below is
				    a flex layout and `.t-stagger-line` would force it to block. */}
				<StaggerLines>
					<SectionTitle title={title} />
					<p className={cn(landingSubheadlineClass, "mx-auto mt-4")}>
						{subtitle}
					</p>
				</StaggerLines>
				<div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
					<a
						className={cn(buttonVariants({ variant: "default" }))}
						href={primaryHref}
						rel={
							primaryHref.startsWith("http") ? "noopener noreferrer" : undefined
						}
						target={primaryHref.startsWith("http") ? "_blank" : undefined}
					>
						{primaryLabel}
					</a>
					<DownloadMenu variant="ghost" />
				</div>
			</div>
		</section>
	);
}
