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

export default function RealmsHero() {
	return (
		<div className="bg-background text-foreground" data-testid="realms-hero">
			<section
				className="relative mx-4 flex min-h-svh items-center overflow-hidden rounded-3xl px-6 py-12 sm:mx-6 sm:px-10 md:mx-8 md:px-16 md:py-16 lg:px-24"
				data-testid="hero-viewport"
			>
				<div className="relative z-10 w-full max-w-2xl">
					<PageHeader
						className="max-w-xl"
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
						titleClassName={landingHeadlineClass}
					/>
					<div className="mt-8 flex flex-wrap items-center gap-3">
						<DownloadMenu
							label="Download"
							showSeparator={false}
							size="default"
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
