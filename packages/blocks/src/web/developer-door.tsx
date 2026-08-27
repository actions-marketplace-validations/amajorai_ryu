import { buttonVariants } from "@ryu/ui/components/button";
import { cn } from "@ryu/ui/lib/utils";
import { ArrowRight, Github, Wrench } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { DEMO_HREF, DOCS_URL } from "./data/resources.tsx";
import { GITHUB_REPO } from "./download.tsx";
import { landingSurfaceCardFlexXlClass } from "./landing-card-tones.ts";
import { Reveal } from "./reveal.tsx";
import { SectionTitle, sectionSubtitleClass } from "./sections.tsx";
import { StaggerLines } from "./stagger-lines.tsx";

/**
 * The two front doors, as a CHOOSER — not a toggle.
 *
 * Ryu is one product sold through two motions that must never share copy: a
 * developer installs it themselves and reads the README in the README's
 * language (gateway, routing, PII/DLP, MCP, BYO); a partner at a firm needs it
 * to already work and should never see a word of that. A toggle would put both
 * vocabularies on one page, which is precisely the thing to avoid — and it
 * would ask the visitor to classify themselves before the page has told them
 * anything.
 *
 * So this routes instead of switching: "hire" is the page you are already on,
 * "build" leaves for GitHub. It sits low on the page because the default
 * reader of a business surface is the firm, and the developer only needs a
 * signpost.
 *
 * The one idea both audiences should recognise is "works with everything,
 * locked to nothing" — stated here in its plain form. Keep that thread; never
 * import the technical form onto this page.
 */
export default function DeveloperDoor() {
	return (
		<section className="container mx-auto px-4 py-16 md:py-20">
			<div className="mx-auto max-w-5xl">
				<StaggerLines className="mx-auto max-w-2xl text-center">
					<SectionTitle title="Two ways in." />
					<p className={cn(sectionSubtitleClass, "mx-auto")}>
						Same product underneath. It works with the tools you already use and
						is locked to none of them.
					</p>
				</StaggerLines>

				<div className="mt-12 grid gap-3 md:grid-cols-2">
					<Reveal>
						<div className={landingSurfaceCardFlexXlClass}>
							<div>
								<Wrench
									aria-hidden="true"
									className="size-5 text-foreground"
									strokeWidth={1.75}
								/>
								<h3 className="mt-4 font-medium text-foreground text-xl tracking-tight">
									Hire AI for your business
								</h3>
								<p className="mt-2 text-muted-foreground text-sm leading-relaxed">
									You have work piling up and need it done, with a record you
									can show a client. We set it up around your firm and you pay
									monthly.
								</p>
							</div>
							<div className="mt-6">
								<Link
									className={cn(buttonVariants({ variant: "default" }))}
									href={DEMO_HREF}
									rel="noopener noreferrer"
									target="_blank"
								>
									Book a free consultation
									<ArrowRight aria-hidden="true" className="size-4" />
								</Link>
							</div>
						</div>
					</Reveal>

					<Reveal delay={0.08}>
						<div className={landingSurfaceCardFlexXlClass}>
							<div>
								<Github
									aria-hidden="true"
									className="size-5 text-foreground"
									strokeWidth={1.75}
								/>
								<h3 className="mt-4 font-medium text-foreground text-xl tracking-tight">
									Build your own AI agents
								</h3>
								<p className="mt-2 text-muted-foreground text-sm leading-relaxed">
									You would rather run it yourself. It is open source, installs
									with one command, and needs no API key to start.
								</p>
							</div>
							<div className="mt-6 flex flex-col gap-3 sm:flex-row">
								<Link
									className={cn(buttonVariants({ variant: "outline" }))}
									href={GITHUB_REPO}
									rel="noopener noreferrer"
									target="_blank"
								>
									<Github
										aria-hidden="true"
										className="size-4"
										strokeWidth={1.5}
									/>
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
					</Reveal>
				</div>
			</div>
		</section>
	);
}
