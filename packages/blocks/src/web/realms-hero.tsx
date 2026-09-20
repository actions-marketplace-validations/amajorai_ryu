"use client";

import { buttonVariants } from "@ryu/ui/components/button";
import { Logo } from "@ryu/ui/components/logo.tsx";
import PageHeader from "@ryu/ui/components/page-header";
import { cn } from "@ryu/ui/lib/utils";
import {
	DISCORD_INVITE_HREF,
	SETUP_RYU_HREF,
	SETUP_RYU_LABEL,
} from "./data/resources.tsx";
import { DownloadMenu } from "./download-menu.tsx";
import { ProductRealmSelector } from "./product-realm-selector.tsx";
import StartupPrograms from "./startup-programs.tsx";

export default function RealmsHero() {
	return (
		<div className="bg-background text-foreground" data-testid="realms-hero">
			<section
				className="border-border border-b text-foreground"
				data-testid="hero-surface"
			>
				<div
					className="relative isolate mx-auto grid max-w-4xl items-center gap-12 overflow-hidden px-6 pt-20 pb-16 md:pt-28 md:pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12"
					data-testid="hero-viewport"
				>
					<div className="max-w-2xl">
						<PageHeader
							className="max-w-2xl"
							stagger={false}
							title="The simplest way to deploy and run agents in the cloud 24/7"
							titleClassName="!text-xl"
						/>
						<div className="mt-8 flex flex-wrap items-center gap-3">
							<DownloadMenu
								className="rounded-full"
								label="Download"
								showSeparator={false}
								size="lg"
							/>
							<a
								className={cn(
									buttonVariants({ size: "lg", variant: "secondary" }),
									"rounded-full"
								)}
								href={SETUP_RYU_HREF}
							>
								{SETUP_RYU_LABEL}
							</a>
							<a
								className={cn(
									buttonVariants({ size: "lg", variant: "outline" }),
									"rounded-full"
								)}
								href={DISCORD_INVITE_HREF}
								rel="noopener noreferrer"
								target="_blank"
							>
								Join our Discord
							</a>
						</div>
					</div>
					<div
						className="flex min-w-0 items-center justify-center"
						data-testid="hero-3d-logo"
					>
						<Logo className="mx-auto" size="min(70vw, 380px)" variant="3d" />
					</div>
				</div>
			</section>
			<StartupPrograms className="mt-0 px-6 pb-0 md:mt-0 md:pb-0" />
			<ProductRealmSelector />
		</div>
	);
}
