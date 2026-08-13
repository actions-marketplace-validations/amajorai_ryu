"use client";

import { AwardBadge } from "@ryu/ui/components/award-badge";
import { buttonVariants } from "@ryu/ui/components/button";
import PageHeader from "@ryu/ui/components/page-header";
import { StaggerReveal } from "@ryu/ui/components/stagger-reveal";
import { cn } from "@ryu/ui/lib/utils";
import { Library } from "lucide-react";
import Link from "next/link";
import { HeroAvatarSocialProof } from "./c-avatar-20.tsx";
import { DownloadMenu } from "./download-menu.tsx";
import HeroWorkflowLoop from "./hero-workflow-loop.tsx";
import { landingHeadlineClass } from "./landing-typography.ts";

const DECOSMIC_HREF = "https://decosmic.com";
const AMAJOR_HREF = "https://amajor.ai";
/** Placeholder — swap for the real Product Hunt post URL before flipping the flag. */
const PRODUCT_HUNT_HREF = "https://www.producthunt.com/products/ryu";

const DEMO_HREF = "https://cal.com/jiaweing/ryu-demo";

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
const HERO_TITLE = "We take the paperwork off your team, so they can sell";

export default function Hero() {
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
								title={HERO_TITLE}
								titleClassName={landingHeadlineClass}
							/>

							{/* Demo leads: the sale starts with a free consultation, and the
							    download is for the person who wants to poke at it first. */}
							<div className="flex flex-col gap-3 sm:flex-row">
								<Link
									className={cn(buttonVariants({ variant: "default" }))}
									href={DEMO_HREF}
									rel="noopener noreferrer"
									target="_blank"
								>
									Book a free consultation
								</Link>
								<DownloadMenu variant="ghost" />
							</div>

							<HeroAvatarSocialProof />
						</StaggerReveal>
					</div>
				</div>

				{/* The real desktop app + floating Island, running one workflow on a loop.
				    The background image is read as the DESKTOP WALLPAPER: the window is
				    inset in it and the Island floats on it, above the window — so the
				    padding here is the wallpaper margin, not decoration. */}
				<div className="relative z-0 w-full px-4 py-6 md:px-8 md:py-8">
					<div className="relative mx-auto flex min-h-[28rem] w-full max-w-7xl items-center justify-center md:min-h-[34rem]">
						<div
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl bg-[url('/background.png')] bg-center bg-cover opacity-80"
						/>
						<div className="relative z-10 w-full max-w-6xl py-8 md:py-12">
							<HeroWorkflowLoop />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
