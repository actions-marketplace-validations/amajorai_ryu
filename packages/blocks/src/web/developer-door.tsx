import { buttonVariants } from "@ryu/ui/components/button";
import { cn } from "@ryu/ui/lib/utils";
import { Github } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { DOCS_URL } from "./data/resources.tsx";
import { GITHUB_REPO } from "./download.tsx";

/**
 * The ONE place the developer motion is allowed to appear on the business
 * front door — and it is an exit, not a pitch.
 *
 * Ryu is sold through two doors that must never share copy: a developer
 * installs it themselves and reads the README in the README's language
 * (gateway, routing, PII/DLP, MCP, BYO); a partner at a firm needs it to
 * already work and never sees a word of that. Everything else on this page is
 * written for the second reader, so the first reader gets a signpost to GitHub
 * rather than a section of the site rewritten around them.
 *
 * The one idea both audiences should recognise is "works with everything,
 * locked to nothing" — stated here in the plain version. Keep that thread; do
 * not import the technical version onto this page.
 */
export default function DeveloperDoor() {
	return (
		<section className="container mx-auto px-4 py-12">
			<div className="mx-auto flex max-w-3xl flex-col items-center gap-4 rounded-2xl bg-muted/40 px-6 py-8 text-center backdrop-blur-sm sm:px-10">
				<p className="font-medium text-foreground">
					Technical, and want to run it yourself?
				</p>
				<p className="max-w-xl text-muted-foreground text-sm leading-relaxed">
					Ryu is open source and installs with one command. It works with the
					agents and models you already use, and it is not locked to any of
					them.
				</p>
				<div className="flex flex-col gap-3 sm:flex-row">
					<Link
						className={cn(buttonVariants({ variant: "outline" }))}
						href={GITHUB_REPO}
						rel="noopener noreferrer"
						target="_blank"
					>
						<Github aria-hidden="true" className="size-4" strokeWidth={1.5} />
						View on GitHub
					</Link>
					<Link
						className={cn(buttonVariants({ variant: "ghost" }))}
						href={DOCS_URL as Route}
						rel="noopener noreferrer"
						target="_blank"
					>
						Read the docs
					</Link>
				</div>
			</div>
		</section>
	);
}
