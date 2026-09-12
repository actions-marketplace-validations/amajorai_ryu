"use client";

import { buttonVariants } from "@ryu/ui/components/button";
import { ChromaticTextReveal } from "@ryu/ui/components/motion/chromatic-text-reveal";
import PageHeader from "@ryu/ui/components/page-header";
import { cn } from "@ryu/ui/lib/utils";
import { DOCS_URL } from "./data/resources.tsx";
import { DownloadMenu } from "./download-menu.tsx";
import { HomeCapabilitySections } from "./home-capability-sections.tsx";
import { landingHeadlineClass } from "./landing-typography.ts";
import ProductLandingCtas from "./product-landing-ctas.tsx";
import { ProductRealmSelector } from "./product-realm-selector.tsx";
import { SectionTitle } from "./sections.tsx";
import { StandaloneServicesSection } from "./standalone-services-section.tsx";
import StartupPrograms from "./startup-programs.tsx";

export default function RealmsHero() {
	return (
		<div className="bg-background text-foreground" data-testid="realms-hero">
			<section
				className="mx-auto flex max-w-6xl flex-col items-center px-6 pt-20 pb-10 text-center md:pt-28 md:pb-12"
				data-testid="hero-viewport"
			>
				<div className="w-full max-w-3xl">
					<PageHeader
						className="mx-auto max-w-2xl text-center"
						stagger={false}
						title={
							<>
								We deploy and run AI agents
								<br />
								<ChromaticTextReveal
									delay={0.3}
									loop={false}
									once
									prefix="safely in the"
									startOnView
									words={["cloud"]}
								/>
							</>
						}
						titleClassName={cn(
							landingHeadlineClass,
							"text-center text-2xl sm:text-3xl md:text-3xl"
						)}
					/>
					<div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
						<DownloadMenu
							className="rounded-full"
							label="Download"
							showSeparator={false}
							size="sm"
						/>
						<a
							className={cn(
								buttonVariants({ variant: "ghost" }),
								"rounded-full"
							)}
							href={DOCS_URL}
							rel="noopener noreferrer"
							target="_blank"
						>
							Documentation
						</a>
					</div>
				</div>
			</section>
			<StartupPrograms className="mt-0 pb-12 md:mt-2 md:pb-16" />
			<div className="mx-auto max-w-6xl px-6 py-16">
				<ProductRealmSelector />
			</div>
			<HomeCapabilitySections />
			<StandaloneServicesSection />
			<section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
				<SectionTitle title="Try Ryu with your team" />
				<ProductLandingCtas className="mt-8 items-start" />
			</section>
		</div>
	);
}
