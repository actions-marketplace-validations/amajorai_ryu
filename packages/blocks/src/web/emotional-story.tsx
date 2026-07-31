import { buttonVariants } from "@ryu/ui/components/button";
import { cn } from "@ryu/ui/lib/utils";
import Link from "next/link";
import { DownloadMenu } from "./download-menu.tsx";
import {
	AuditSafetyMock,
	ChatbotOnlyMock,
	DemoDeathMock,
	GovernedAgentMock,
	InstallLocalMock,
	SevenMinuteMock,
	StillRunningMock,
} from "./emotional-story-mockups.tsx";
import {
	BentoCard,
	BentoGrid,
	type BentoItem,
	SectionTitle,
} from "./sections.tsx";

const THREE_PATHS: BentoItem[] = [
	{
		title: "The demo is not the deployment",
		description:
			"An agent can look impressive and still fail its first production review.",
		visual: <DemoDeathMock />,
	},
	{
		title: "No control layer",
		description:
			"Without tools, memory, or an audit trail, chat stops where real work starts.",
		visual: <ChatbotOnlyMock />,
	},
	{
		title: "The real blockers",
		description:
			"Customer data leaves, the bill is a guess, and nobody owns the runtime.",
		visual: <AuditSafetyMock />,
	},
];

const RYU_PATH_ITEMS: BentoItem[] = [
	{
		title: "Bring any agent",
		description:
			"Use Claude Code, Codex, Gemini, OpenClaw, Ollama, or an agent you built.",
		visual: <InstallLocalMock />,
	},
	{
		title: "Govern every call",
		description:
			"Audit chain, PII redaction, approvals, and budget ceilings stay in the path.",
		span: "md:col-span-2",
		visual: <GovernedAgentMock />,
	},
	{
		title: "Start with one real workflow",
		description:
			"Install, connect your tools, and run work. Add more agents as the team grows.",
		span: "md:col-span-2",
		visual: <SevenMinuteMock />,
		action: <DownloadMenu />,
	},
	{
		title: "Keep the option to leave",
		description:
			"Open standards and local-first deployment work on your laptop, your servers, or managed cloud.",
		visual: <StillRunningMock />,
		action: (
			<Link
				className={cn(buttonVariants({ variant: "ghost" }), "inline-flex")}
				href="https://cal.com/jiaweing/ryu-demo"
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
					<SectionTitle title="Agents are easy to demo. Running them for real is the hard part." />
					<p className="mt-4 max-w-xl text-muted-foreground leading-relaxed">
						Adoption is not the problem. The missing layer is what makes an
						agent private, governable, and dependable enough to run every day.
					</p>
				</div>

				<div className="grid grid-cols-1 gap-3 md:grid-cols-3">
					{THREE_PATHS.map((item) => (
						<BentoCard item={item} key={item.title} />
					))}
				</div>

				<div className="mt-12 md:mt-16">
					<p className="mb-6 font-medium text-foreground text-sm">
						The control layer Ryu provides
					</p>
					<BentoGrid items={RYU_PATH_ITEMS} />
				</div>
			</div>
		</section>
	);
}
