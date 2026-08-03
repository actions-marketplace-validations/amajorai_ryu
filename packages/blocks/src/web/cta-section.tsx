"use client";

import { buttonVariants } from "@ryu/ui/components/button";
import { cn } from "@ryu/ui/lib/utils";
import Link from "next/link";
import { DownloadMenu } from "./download-menu.tsx";
import { landingSubheadlineClass } from "./landing-typography.ts";
import { SectionTitle } from "./section-title.tsx";
import { StaggerLines } from "./stagger-lines.tsx";

export default function CtaSection() {
	return (
		<section className="container mx-auto px-4 py-24">
			<div className="mx-auto max-w-2xl text-center">
				{/* Wraps only the title and its supporting line: the button row below is
				    a flex layout and `.t-stagger-line` would force it to block. */}
				<StaggerLines>
					<SectionTitle title="Put your agents into production." />
					<p className={cn(landingSubheadlineClass, "mx-auto mt-4")}>
						Bring the agents and tools you already run. Ryu keeps every call
						governed with routing, redaction, budgets, and audit included.
					</p>
				</StaggerLines>
				<div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
					<DownloadMenu />
					<Link
						className={cn(buttonVariants({ variant: "ghost" }))}
						href="https://cal.com/jiaweing/ryu-demo"
						rel="noopener noreferrer"
						target="_blank"
					>
						Book a demo
					</Link>
				</div>
			</div>
		</section>
	);
}
