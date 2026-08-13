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
		title: "One wrong output is a liability",
		description:
			"On a client file a mistake is not an inconvenience. Somebody is answerable for it.",
		visual: <DemoDeathMock />,
	},
	{
		title: "Nobody can explain what it did",
		description:
			"When the client asks why, there is no answer anyone can read. So nobody signs.",
		visual: <ChatbotOnlyMock />,
	},
	{
		title: "The bill is a guess",
		description:
			"Finance blocks it before it starts, because nothing says what next month costs.",
		visual: <AuditSafetyMock />,
	},
];

const RYU_PATH_ITEMS: BentoItem[] = [
	{
		title: "Keep the tools you already pay for",
		description:
			"ChatGPT, Claude, Gemini, or one we set up for you. We make them safe on client files instead of replacing them.",
		visual: <InstallLocalMock />,
	},
	{
		title: "We show you exactly what it did",
		description:
			"Every step written down as it happens: what it read, what it changed, who approved it, what it cost.",
		span: "md:col-span-2",
		visual: <GovernedAgentMock />,
	},
	{
		title: "Start with one job you already know",
		description:
			"Pick the work eating the most hours. We set it up around your documents and your rules, then you decide whether it goes wider.",
		span: "md:col-span-2",
		visual: <SevenMinuteMock />,
		action: <DownloadMenu />,
	},
	{
		title: "Nothing leaves the building",
		description:
			"It runs on your own machines. Or we run it for you, under the same limits, and you can move it back.",
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
					<SectionTitle title="The work is done. Now somebody has to put their name on it." />
					<p className="mt-4 max-w-xl text-muted-foreground leading-relaxed">
						That is where it stops. Not because the AI is bad, but because the
						firm has no way to prove how the work was done.
					</p>
				</div>

				<div className="grid grid-cols-1 gap-3 md:grid-cols-3">
					{THREE_PATHS.map((item) => (
						<BentoCard item={item} key={item.title} />
					))}
				</div>

				<div className="mt-12 md:mt-16">
					<p className="mb-6 font-medium text-foreground text-sm">
						What you get instead
					</p>
					<BentoGrid items={RYU_PATH_ITEMS} />
				</div>
			</div>
		</section>
	);
}
