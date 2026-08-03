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
	"We spent years shipping agents and kept hitting the same wall: an agent could work in a demo and still fail the first production review.",
	"The blockers were always the same. No audit chain. Customer data leaving by default. An unforecastable bill. A runtime that needed a platform team to stay alive.",
	"Ryu is the layer we wanted: one interface and one control layer around the agents a company already runs.",
	"Bring Claude Code, Codex, Gemini, OpenClaw, Ollama, or your own agent. Ryu adds routing, governance, and audit without asking you to rebuild the stack.",
	"We use Ryu to build Ryu, and we are building the layer so smaller teams can run serious agent workflows without hiring an AI platform team.",
];

export default function LandingTestimonials() {
	return (
		<section className="container mx-auto px-4">
			<div className="mx-auto max-w-3xl">
				<StaggerLines className="mb-10 max-w-2xl">
					<SectionTitle title="Built by people who learned this the hard way" />
					<p className={sectionSubtitleClass}>
						The demo is easy. The control layer that lets an agent run every day
						is the part we built.
					</p>
				</StaggerLines>

				<Card className="rounded-3xl border border-border/60 bg-card p-8 shadow-sm md:p-12">
					<div className="space-y-6 text-base text-foreground/90 leading-relaxed md:text-lg md:leading-relaxed">
						{STORY_PARAGRAPHS.map((paragraph) => (
							<p key={paragraph}>{paragraph}</p>
						))}
					</div>

					<div className="mt-10">
						<Signature
							className="text-foreground"
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
