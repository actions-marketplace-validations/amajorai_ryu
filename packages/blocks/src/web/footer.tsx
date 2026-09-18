"use client";

import { useLocalizedText } from "@ryu/i18n/react";
import { Logo } from "@ryu/ui/components/logo.tsx";
import type { ReactNode } from "react";

import Aurora from "./aurora.tsx";
import FooterBuildInfo from "./footer-build-info.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";
import "./footer.css";

// Cache Components requires client prerenders to be deterministic.
const COPYRIGHT_YEAR = 2026;

function LocalizedFooterCopy({ value }: { value: string }) {
	return <>{useLocalizedText(value, { literal: true })}</>;
}

export default function Footer({
	githubStargazersCount,
	languagePicker,
	soundToggle,
}: {
	githubStargazersCount?: number | null;
	languagePicker?: ReactNode;
	soundToggle?: ReactNode;
}) {
	const localizedHeroTitle = useLocalizedText(
		"The universal AI integration layer",
		{ literal: true }
	);
	const localizedHeroDescription = useLocalizedText(
		"We deploy and keep your agents running for you. Connect the tools it needs and integrate where you want it to run.",
		{ literal: true }
	);
	return (
		<footer className="relative overflow-x-clip pt-16">
			{/* Content sits above the Aurora and outline mark and stays on shared surfaces. */}
			<div className="container relative z-10 mx-auto px-4">
				{/* Two column links */}
				<div className="mb-12 grid grid-cols-1 gap-12 md:grid-cols-2">
					<div className="space-y-4">
						<h3 className="font-medium text-2xl">{localizedHeroTitle}</h3>
						<p className="max-w-md text-muted-foreground">
							{localizedHeroDescription}
						</p>
					</div>

					<div className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3 sm:gap-x-12 lg:gap-x-16">
						<div>
							<h4 className="mb-4 font-medium">
								<LocalizedFooterCopy value="Platform" />
							</h4>
							<div className="space-y-2">
								<a
									className="block text-muted-foreground transition-colors hover:text-foreground"
									href="/products/sdk"
								>
									<LocalizedFooterCopy value="SDK" />
								</a>
								<a
									className="block text-muted-foreground transition-colors hover:text-foreground"
									href="/products/core"
								>
									<LocalizedFooterCopy value="Core" />
								</a>
								<a
									className="block text-muted-foreground transition-colors hover:text-foreground"
									href="/products/gateway"
								>
									<LocalizedFooterCopy value="Gateway" />
								</a>
								<a
									className="block text-muted-foreground transition-colors hover:text-foreground"
									href="/products/apps"
								>
									<LocalizedFooterCopy value="Ryu Apps" />
								</a>
								<a
									className="block text-muted-foreground transition-colors hover:text-foreground"
									href="/platform#infra"
								>
									<LocalizedFooterCopy value="Ryu Infra" />
								</a>
							</div>
						</div>

						<div>
							<h4 className="mb-4 font-medium">
								<LocalizedFooterCopy value="Learn" />
							</h4>
							<div className="space-y-2">
								<a
									className="block text-muted-foreground transition-colors hover:text-foreground"
									href="/academy"
								>
									<LocalizedFooterCopy value="Academy" />
								</a>
								<a
									className="block text-muted-foreground transition-colors hover:text-foreground"
									href="/certifications"
								>
									<LocalizedFooterCopy value="Certifications" />
								</a>
								<a
									className="block text-muted-foreground transition-colors hover:text-foreground"
									href="/products/cli"
								>
									<LocalizedFooterCopy value="CLI" />
								</a>
								<a
									className="block text-muted-foreground transition-colors hover:text-foreground"
									href="/products/sdk"
								>
									<LocalizedFooterCopy value="SDK" />
								</a>
								<a
									className="block text-muted-foreground transition-colors hover:text-foreground"
									href="/products/mcp"
								>
									<LocalizedFooterCopy value="MCP" />
								</a>
							</div>
						</div>

						<div>
							<h4 className="mb-4 font-medium">
								<LocalizedFooterCopy value="Company" />
							</h4>
							<div className="space-y-2">
								<a
									className="block text-muted-foreground transition-colors hover:text-foreground"
									href="/for/agent-operators"
								>
									<LocalizedFooterCopy value="AI operators" />
								</a>
								<a
									className="block text-muted-foreground transition-colors hover:text-foreground"
									href="/startups"
								>
									<LocalizedFooterCopy value="Programs" />
								</a>
								<a
									className="block text-muted-foreground transition-colors hover:text-foreground"
									href="/security"
								>
									<LocalizedFooterCopy value="Security" />
								</a>
								<a
									className="block text-muted-foreground transition-colors hover:text-foreground"
									href="/partners"
								>
									<LocalizedFooterCopy value="Partners" />
								</a>
								<a
									className="block text-muted-foreground transition-colors hover:text-foreground"
									href="/perks"
								>
									<LocalizedFooterCopy value="Perks" />
								</a>
							</div>
						</div>
					</div>
				</div>

				{/* Horizontal links + copyright */}
				<div className="mt-32 space-y-4 text-center">
					<FooterBuildInfo githubStargazersCount={githubStargazersCount} />
					<div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-muted-foreground text-sm">
						<ThemeToggle />
						{soundToggle}
						{languagePicker}
						<a
							className="transition-colors hover:text-foreground"
							href="/privacy"
						>
							<LocalizedFooterCopy value="Privacy" />
						</a>
						<a
							className="transition-colors hover:text-foreground"
							href="/terms"
						>
							<LocalizedFooterCopy value="Terms" />
						</a>
						<a
							className="transition-colors hover:text-foreground"
							href="/contact"
						>
							<LocalizedFooterCopy value="Contact" />
						</a>
						<a className="transition-colors hover:text-foreground" href="/dpa">
							<span className="hidden lg:block">
								<LocalizedFooterCopy value="Data Processing Agreement" />
							</span>
							<span className="block lg:hidden">
								<LocalizedFooterCopy value="DPA" />
							</span>
						</a>
					</div>

					<p
						className="pb-20 text-muted-foreground text-sm"
						itemScope
						itemType="https://schema.org/Organization"
					>
						© {COPYRIGHT_YEAR} <span itemProp="name">A Major Pte. Ltd.</span>,{" "}
						<span itemProp="location">Singapore</span>. <br />
						(UEN: <span itemProp="taxID">202616096G</span>)
						<meta content="2026-04-12" itemProp="foundingDate" />
						<meta content="https://amajor.ai" itemProp="url" />
						<meta
							content="A Major is a Singapore-based software agency specialising in web design, software development, and digital solutions for businesses."
							itemProp="description"
						/>
					</p>
				</div>
			</div>

			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[38rem] [mask-image:linear-gradient(to_top,black_72%,transparent)]"
			>
				<Aurora amplitude={0.2} blend={0.65} fan={0.65} speed={2.5} />
			</div>

			{/* Giant Ryu outline — only the top half rises into view; the eyes track the cursor. */}
			<div className="relative z-10 -mt-6 flex h-[clamp(10rem,20vw,16rem)] -translate-y-20 items-start justify-center overflow-hidden sm:translate-y-0">
				<div
					aria-hidden="true"
					className="pointer-events-none origin-top -translate-x-16 scale-90 select-none text-foreground/15 sm:scale-110 md:scale-125 lg:scale-150"
					data-testid="footer-ryu-logo"
				>
					<Logo
						animated
						className="footer-ryu-logo__mark"
						size="360px"
						variant="outline"
					/>
				</div>
			</div>
		</footer>
	);
}
