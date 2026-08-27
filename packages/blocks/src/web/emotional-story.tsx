import { buttonVariants } from "@ryu/ui/components/button";
import { cn } from "@ryu/ui/lib/utils";
import Link from "next/link";
import { DownloadMenu } from "./download-menu.tsx";
import {
	AuditSafetyMock,
	ChatbotOnlyMock,
	DemoDeathMock,
	InstallLocalMock,
	SevenMinuteMock,
	StillRunningMock,
	TrustReceiptMock,
} from "./emotional-story-mockups.tsx";
import {
	BentoCard,
	BentoGrid,
	type BentoItem,
	SectionTitle,
} from "./sections.tsx";

const THREE_PATHS: BentoItem[] = [
	{
		title: "The answer still needs a second answer",
		description:
			"Your team checks it, rewrites it, and carries the risk when the source is unclear or the output is wrong.",
		visual: <DemoDeathMock />,
	},
	{
		title: "Your AI cannot reach the work",
		description:
			"The files and systems that matter stay outside the prompt, so someone copies context by hand and hopes nothing was missed.",
		visual: <ChatbotOnlyMock />,
	},
	{
		title: "The savings disappear in cleanup",
		description:
			"The model is cheap. Checking, rework, and surprise usage are what make AI expensive for a startup.",
		visual: <AuditSafetyMock />,
	},
];

const RYU_PATH_ITEMS: BentoItem[] = [
	{
		title: "Keep the AI you already pay for",
		description:
			"ChatGPT, Claude, Gemini, or a local model. Ryu adds the trust layer around the tools your team already knows.",
		visual: <InstallLocalMock />,
	},
	{
		title: "See why the answer is safe to use",
		description:
			"Keep the source, output, changes, review, and cost together in a record anyone on the team can read.",
		span: "md:col-span-2",
		visual: <TrustReceiptMock />,
	},
	{
		title: "Give AI the access it actually needs",
		description:
			"Start with one workflow, connect the approved files and systems, and decide what leaves your company data boundary.",
		span: "md:col-span-2",
		visual: <SevenMinuteMock />,
		action: <DownloadMenu />,
	},
	{
		title: "Set a cost you can defend",
		description:
			"Run locally or let us run it for you. The same limits, records, and review points apply either way.",
		visual: <StillRunningMock />,
		action: (
			<Link
				className={cn(buttonVariants({ variant: "ghost" }), "inline-flex")}
				href="https://cal.com/amajor/ryu-demo"
				rel="noopener noreferrer"
				target="_blank"
			>
				Book a demo
			</Link>
		),
	},
];

export default function EmotionalStory() {
	return (
		<section className="container mx-auto px-4 py-20 md:py-28">
			<div className="mx-auto max-w-6xl">
				<div className="mb-10 max-w-2xl">
					<SectionTitle title="AI is useful. It still needs too much checking." />
					<p className="mt-4 max-w-xl text-muted-foreground leading-relaxed">
						Your team checks the output, copies context between tools, and takes
						responsibility when it is wrong.
					</p>
				</div>

				<div className="grid grid-cols-1 gap-3 md:grid-cols-3">
					{THREE_PATHS.map((item) => (
						<BentoCard item={item} key={item.title} />
					))}
				</div>

				<div className="mt-12 md:mt-16">
					<p className="mb-6 font-medium text-foreground text-sm">
						What trusted AI looks like
					</p>
					<BentoGrid items={RYU_PATH_ITEMS} />
				</div>
			</div>
		</section>
	);
}
