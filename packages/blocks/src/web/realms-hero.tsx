"use client";

import { buttonVariants } from "@ryu/ui/components/button";
import { ChromaticTextReveal } from "@ryu/ui/components/motion/chromatic-text-reveal";
import PageHeader from "@ryu/ui/components/page-header";
import { cn } from "@ryu/ui/lib/utils";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { DOCS_URL } from "./data/resources.tsx";
import { DownloadMenu } from "./download-menu.tsx";
import HeroWorkflowLoop, {
	HeroUseCaseSwitcher,
} from "./hero-workflow-loop.tsx";
import { landingHeadlineClass } from "./landing-typography.ts";
import ProductLandingCtas from "./product-landing-ctas.tsx";
import { ProductRealmSelector } from "./product-realm-selector.tsx";
import {
	BentoGrid,
	type BentoItem,
	SectionTitle,
	sectionSubtitleClass,
} from "./sections.tsx";
import { StandaloneServicesSection } from "./standalone-services-section.tsx";

const INTEGRATION_ITEMS: BentoItem[] = [
	{
		title: "Use your models",
		description:
			"Connect the providers and AI subscriptions your team already uses.",
	},
	{
		title: "Connect your tools",
		description:
			"Give agents access to the files and services they need for the task.",
	},
	{
		title: "Set access and spending limits",
		description:
			"Choose which actions need approval and review the run history.",
	},
	{
		title: "Run in the cloud",
		description:
			"Deploy the workflow so it can run when your laptop is closed.",
	},
];

export default function RealmsHero() {
	const [scenarioIndex, setScenarioIndex] = useState(0);
	return (
		<div className="bg-background text-foreground" data-testid="realms-hero">
			<section className="mx-auto max-w-6xl px-6 pt-16 pb-16 md:pt-24 md:pb-24">
				<div className="max-w-2xl">
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
							separatorClassName="bg-primary-foreground/10 data-vertical:mx-0"
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
				<div className="mt-14" data-product-visual>
					<HeroUseCaseSwitcher
						current={scenarioIndex}
						onPick={setScenarioIndex}
					/>
					<div className="relative mt-4 flex min-h-[28rem] items-center justify-center overflow-hidden rounded-xl bg-muted px-4 py-6 md:min-h-[34rem] md:px-8 md:py-10">
						<Image
							alt=""
							aria-hidden="true"
							className="pointer-events-none absolute inset-x-0 top-0 h-auto w-full max-w-none opacity-80"
							data-testid="hero-workflow-background"
							height={1440}
							priority
							sizes="(max-width: 1152px) calc(100vw - 48px), 1104px"
							src="/background.png"
							width={2520}
						/>
						<div className="relative z-10 w-full max-w-6xl py-4 md:py-6">
							<HeroWorkflowLoop
								onScenarioChange={setScenarioIndex}
								scenarioIndex={scenarioIndex}
							/>
						</div>
					</div>
				</div>
			</section>
			<div className="mx-auto max-w-6xl px-6 py-16">
				<ProductRealmSelector />
			</div>
			<section
				className="mx-auto max-w-6xl px-6 py-16 md:py-24"
				id="integration-layer"
			>
				<div className="mb-12 max-w-2xl">
					<SectionTitle title="Connect your agents to the work" />
					<p className={sectionSubtitleClass}>
						Use Ryu with your existing tools. Control what agents can access,
						what they can spend, and when they need your approval.
					</p>
				</div>
				<BentoGrid items={INTEGRATION_ITEMS} />
			</section>
			<section
				className="bg-muted/40"
				data-testid="managed-deployment"
				id="managed-deployment"
			>
				<div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-2 md:gap-16 md:py-24">
					<div>
						<SectionTitle title="We run the infrastructure" />
						<p className={sectionSubtitleClass}>
							Ryu is the integration layer for AI. We deploy and maintain the
							runtime so your team can focus on the workflows it needs.
						</p>
						<Link
							className="mt-6 inline-flex font-medium text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
							href="/console"
						>
							See Ryu Console
						</Link>
					</div>
					<dl className="space-y-8">
						<div>
							<dt className="font-medium">Deployment and maintenance</dt>
							<dd className="mt-2 text-muted-foreground leading-relaxed">
								Run agents and their connected tools in the cloud.
							</dd>
						</div>
						<div>
							<dt className="font-medium">Permissions and approvals</dt>
							<dd className="mt-2 text-muted-foreground leading-relaxed">
								Decide which tools an agent can use and which actions your team
								reviews.
							</dd>
						</div>
						<div>
							<dt className="font-medium">Usage and run history</dt>
							<dd className="mt-2 text-muted-foreground leading-relaxed">
								Check costs, results, and errors from the same console.
							</dd>
						</div>
					</dl>
				</div>
			</section>
			<StandaloneServicesSection />
			<section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
				<SectionTitle title="Try Ryu with your team" />
				<ProductLandingCtas className="mt-8 items-start" />
			</section>
		</div>
	);
}
