"use client";

import { AwardBadge } from "@ryu/ui/components/award-badge";
import { buttonVariants } from "@ryu/ui/components/button";
import { ChromaticTextReveal } from "@ryu/ui/components/motion/chromatic-text-reveal";
import PageHeader from "@ryu/ui/components/page-header";
import { StaggerReveal } from "@ryu/ui/components/stagger-reveal";
import { cn } from "@ryu/ui/lib/utils";
import { Library } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { HeroAvatarSocialProof } from "./c-avatar-20.tsx";
import { DEMO_HREF, DOCS_URL } from "./data/resources.tsx";
import HeroWorkflowLoop, {
	HeroUseCaseSwitcher,
} from "./hero-workflow-loop.tsx";
import { landingHeadlineClass } from "./landing-typography.ts";

const DECOSMIC_HREF = "https://decosmic.com";
const AMAJOR_HREF = "https://amajor.ai";
/** Placeholder — swap for the real Product Hunt post URL before flipping the flag. */
const PRODUCT_HUNT_HREF = "https://www.producthunt.com/products/ryu";

/**
 * The Product Hunt badge is staged, not live: flip this to `true` on the day the
 * award is actually won. It gates the *render*, not a `hidden` class, because a
 * CSS-hidden badge still ships in the DOM — crawlers, scrapers and view-source
 * would all find us claiming an award we have not won yet.
 */
const SHOW_AWARD_BADGE = false;

/**
 * Leads with the buyer's pain, not our category. Nobody wakes up wanting
 * agents — they wake up buried in paperwork nobody will sign off on. The
 * safety half of the pitch (the record, the cost ceiling) is why they are
 * ALLOWED to buy, never why they want to, so it stays out of the hero and
 * lands in the trust strip directly below it.
 *
 * Two lines. Anything longer stops reading as a claim and starts reading as
 * a paragraph.
 */
const HERO_TITLE =
	"The document work that fills your team's week, done overnight.";

/**
 * The headline gets the same chromatic sweep every section header on this page
 * already has (`SectionTitle`): the fixed text, then the final word painted by a
 * moving clipped gradient.
 *
 * It is composed here rather than handing the whole string to `ChromaticTextReveal`
 * because that component wraps its own `prefix` in `whitespace-nowrap` — fine for a
 * three-word section header, but it would force this two-line headline onto one
 * unbreakable line. So the prefix stays ordinary wrapping text inside the heading and
 * only the last word goes through the sweep, with the component's own leading NBSP as
 * the separator (hence no JSX space here — one would double it).
 */
const HERO_TITLE_LAST_SPACE = HERO_TITLE.lastIndexOf(" ");
// Guarded the same way `SectionTitle` guards it: a one-word headline has no space,
// and an unguarded `slice(0, -1)` would put all-but-the-last-CHARACTER in the prefix
// and sweep a single letter. The headline above is edited often enough that this is
// worth a ternary.
const HERO_TITLE_PREFIX =
	HERO_TITLE_LAST_SPACE === -1
		? ""
		: HERO_TITLE.slice(0, HERO_TITLE_LAST_SPACE);
const HERO_TITLE_LAST_WORD =
	HERO_TITLE_LAST_SPACE === -1
		? HERO_TITLE
		: HERO_TITLE.slice(HERO_TITLE_LAST_SPACE + 1);

/** Lets the surrounding `StaggerReveal` finish lifting the headline into place
 *  before the sweep runs, so the two motions read as one after the other instead of
 *  blurring the same word twice at once. */
const HERO_SWEEP_DELAY_S = 0.3;

export default function Hero() {
	// Owned here, not inside the stage, so the pills can sit above the wallpaper
	// while the loop they drive sits inside it.
	const [scenarioIndex, setScenarioIndex] = useState(0);

	return (
		<div className="flex flex-col items-center gap-8 pt-14 pb-0 md:pt-20">
			<div className="flex min-h-[80vh] w-screen flex-col px-4 md:flex md:items-center md:justify-center md:px-0">
				<div className="mx-auto w-full max-w-6xl px-4 py-8 md:py-12">
					<div className="space-y-8">
						<StaggerReveal>
							{/* Wrapped so StaggerReveal's cloned className/style land on a real
							    DOM node — AwardBadge takes className but not style. */}
							{SHOW_AWARD_BADGE && (
								<div>
									<AwardBadge
										href={PRODUCT_HUNT_HREF}
										place={1}
										type="product-of-the-day"
									/>
								</div>
							)}

							<p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground text-xs tracking-tight md:text-sm">
								From the team behind{" "}
								<a
									className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 transition-colors hover:text-foreground/80 hover:underline"
									href={DECOSMIC_HREF}
									rel="noopener noreferrer"
									target="_blank"
								>
									<span className="inline-flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-[#0099ff] text-white">
										<Library
											aria-hidden="true"
											className="size-2.5"
											strokeWidth={2.25}
										/>
									</span>
									Decosmic
								</a>
								<span aria-hidden="true">&</span>
								<a
									className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 transition-colors hover:text-foreground/80 hover:underline"
									href={AMAJOR_HREF}
									rel="noopener noreferrer"
									target="_blank"
								>
									<img
										alt=""
										className="size-4 shrink-0 rounded-[5px] object-cover"
										src="/logos/amajor.png"
									/>
									A Major
								</a>
							</p>

							<PageHeader
								className="max-w-2xl whitespace-pre-line"
								stagger={false}
								title={
									<>
										{HERO_TITLE_PREFIX}
										<ChromaticTextReveal
											delay={HERO_SWEEP_DELAY_S}
											loop={false}
											once
											prefix=""
											startOnView
											words={[HERO_TITLE_LAST_WORD]}
										/>
									</>
								}
								titleClassName={landingHeadlineClass}
							/>

							{/* The two doors, stated as intents rather than as a toggle: the
							    default reader of this page is the firm, and the developer
							    gets one exit to the docs. Download deliberately is NOT here —
							    a partner never downloads anything, and it already sits in the
							    site header for the reader who wants it. */}
							<div className="flex flex-col gap-3 sm:flex-row">
								<Link
									className={cn(buttonVariants({ variant: "default" }))}
									href={DEMO_HREF}
									rel="noopener noreferrer"
									target="_blank"
								>
									I want to hire AI
								</Link>
								<Link
									className={cn(buttonVariants({ variant: "ghost" }))}
									href={DOCS_URL as Route}
									rel="noopener noreferrer"
									target="_blank"
								>
									I want to build AI
								</Link>
							</div>

							<HeroAvatarSocialProof />
						</StaggerReveal>
					</div>
				</div>

				{/* The real desktop app + floating Island, running one workflow on a loop.
				    The background image is read as the DESKTOP WALLPAPER: the window is
				    inset in it and the Island floats on it, above the window — so the
				    padding here is the wallpaper margin, not decoration. */}
				{/* Use-case pills ride ABOVE the wallpaper, centered. Inside the
				    background image they read as chrome belonging to the mock app;
				    out here they read as what they are — a menu of jobs it runs. */}
				<div className="w-full px-4 pt-2 pb-0 md:px-8">
					<div className="mx-auto max-w-6xl">
						<HeroUseCaseSwitcher
							current={scenarioIndex}
							onPick={setScenarioIndex}
						/>
					</div>
				</div>

				<div className="relative z-0 w-full px-4 pt-3 pb-6 md:px-8 md:pt-4 md:pb-8">
					<div className="relative mx-auto flex min-h-[28rem] w-full max-w-7xl items-center justify-center md:min-h-[34rem]">
						<div
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl bg-[url('/background.png')] bg-center bg-cover opacity-80"
						/>
						<div className="relative z-10 w-full max-w-6xl py-8 md:py-12">
							<HeroWorkflowLoop
								onScenarioChange={setScenarioIndex}
								scenarioIndex={scenarioIndex}
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
