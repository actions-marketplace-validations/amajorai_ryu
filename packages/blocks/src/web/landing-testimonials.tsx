"use client";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@ryu/ui/components/avatar.tsx";
import { Card } from "@ryu/ui/components/card.tsx";
import { Signature } from "@ryu/ui/components/signature.tsx";
import { SectionTitle, sectionSubtitleClass } from "./sections.tsx";
import { StaggerLines } from "./stagger-lines.tsx";

const STORY_PARAGRAPHS = [
	"We kept using AI and still did not trust it with the work that mattered.",
	"The model was not the only problem. We had no clear way to show what it saw, no safe path into company data, and no cost boundary we could explain to the team.",
	"Ryu is built around that gap. It gives startups a clear record, controlled access, and a predictable way to use the AI they already chose.",
	"Keep ChatGPT and Claude. Connect the context your work depends on. Review the result with the evidence beside it, then decide what is ready to ship.",
	"We are building Ryu because startups should not need an AI platform team just to use AI responsibly.",
];

export default function LandingTestimonials() {
	return (
		<section className="container mx-auto px-4">
			<div className="mx-auto max-w-3xl">
				<StaggerLines className="mb-10 max-w-2xl">
					<SectionTitle title="AI was still a solo tool." />
					<p className={sectionSubtitleClass}>
						We built Ryu to make it usable by a team.
					</p>
				</StaggerLines>

				<Card className="rounded-3xl border border-border/60 bg-card p-8 shadow-sm md:p-12">
					<div className="space-y-6 text-base text-foreground/90 leading-relaxed md:text-lg md:leading-relaxed">
						{STORY_PARAGRAPHS.map((paragraph) => (
							<p key={paragraph}>{paragraph}</p>
						))}
					</div>

					<div className="mt-6">
						<Signature
							className="h-auto max-w-full text-foreground"
							fontSize={24}
							inView
							text="Jia Wei Ng"
						/>
					</div>

					<div className="mt-12 flex items-center gap-4">
						<Avatar className="size-12 rounded-xl">
							<AvatarImage
								alt="Jia Wei Ng"
								className="rounded-xl object-cover"
								src="/team/jiawei-ng.png"
							/>
							<AvatarFallback className="rounded-xl font-medium text-sm">
								JW
							</AvatarFallback>
						</Avatar>
						<div>
							<p className="font-medium text-foreground">Jia Wei Ng</p>
							<p className="text-muted-foreground text-sm">
								Co-Founder & CEO, A Major
							</p>
						</div>
					</div>
				</Card>
			</div>
		</section>
	);
}
