import {
	BouncyAccordion,
	type BouncyAccordionItem,
} from "@ryu/ui/components/bouncy-accordion";

import { SectionTitle } from "./section-title.tsx";

export interface FAQItem {
	content: string | string[];
	id: string;
	title: string;
}

export const GENERAL_FAQ_ITEMS: FAQItem[] = [
	{
		id: "1",
		title: "What is Ryu?",
		content: [
			"Ryu is a local-first app and gateway for AI agents. It helps businesses run agents without stitching together models, tools, memory, budgets, and security from scratch.",
		],
	},
	{
		id: "2",
		title: "What's the difference between Ryu App and Ryu Gateway?",
		content: [
			"Ryu App is where people use agents, manage workflows, connect tools, and review usage.",
			"Ryu Gateway is the control layer behind those agents. It routes calls to local or cloud models, enforces budgets and policy, and keeps an audit trail. You can run it locally, self-host it, or use managed cloud.",
		],
	},
	{
		id: "3",
		title: "Which AI models does Ryu support?",
		content: [
			"Ryu supports OpenAI, Anthropic, Gemini, local models via Ollama or compatible runtimes, and 400+ models through supported providers. The router handles model switching, so your agent code does not change when you swap providers.",
		],
	},
	{
		id: "4",
		title: "What is MCP and how does Ryu use it?",
		content: [
			"MCP (Model Context Protocol) is an open standard for connecting AI models to external tools and data sources. Ryu ships with a registry of 250+ MCP tools - GitHub, Slack, Postgres, browsers, email, and more. Your agents get access instantly, no manual wiring required.",
		],
	},
	{
		id: "5",
		title: "How does Ryu help control AI spend?",
		content: [
			"Ryu runs work locally when a local model is good enough, routes expensive calls only when needed, and gives each agent or team a budget. You can see which agents, tools, and models are spending money.",
		],
	},
	{
		id: "6",
		title: "Can I use Ryu with agents I've already built?",
		content: [
			"Yes. Bring Claude Code, Codex, Gemini, OpenClaw, Ollama, or an agent you built. Ryu Gateway is OpenAI-compatible, so existing agents can point at it without a rewrite.",
		],
	},
	{
		id: "7",
		title: "Is my data private?",
		content: [
			"Ryu is local-first and has no telemetry by default. You can keep sensitive work fully on your machine, or route selected calls through cloud models with Gateway policy, redaction, budgets, and audit.",
		],
	},
	{
		id: "8",
		title: "Who is Ryu for?",
		content: [
			"Ryu is built first for startups and SMEs that want agents across real business workflows without an AI infrastructure project. Consumers and power users can use the same app locally, but the main business product is team control, cost control, and rollout support.",
		],
	},
	{
		id: "9",
		title: "How much does Ryu cost?",
		content: [
			"Ryu has a free local-first path, paid Pro and Max plans for cloud features and credits, Teams for shared billing and roles, and Enterprise for managed rollout, custom policies, and deployment support.",
		],
	},
	{
		id: "10",
		title: "Is Ryu open source?",
		content: [
			"Ryu follows an open-core model. Core and Gateway are the self-hostable foundation, while the desktop app, managed cloud, and business features are commercial.",
		],
	},
];

interface FAQProps {
	items?: FAQItem[];
}

function faqAnswer(content: FAQItem["content"]) {
	const paragraphs = Array.isArray(content) ? content : [content];

	return (
		<div className="space-y-3">
			{paragraphs.map((paragraph, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static content
				<p key={index}>{paragraph}</p>
			))}
		</div>
	);
}

export default function FAQ({ items = GENERAL_FAQ_ITEMS }: FAQProps) {
	const accordionItems: BouncyAccordionItem[] = items.map((item) => ({
		id: item.id,
		title: item.title,
		description: faqAnswer(item.content),
	}));

	return (
		<div className="container mx-auto px-4 py-16">
			<div className="mx-auto flex max-w-2xl flex-col gap-4">
				<div>
					<SectionTitle size="compact" title="Frequently Asked Questions" />
				</div>

				<BouncyAccordion
					classNames={{
						// Keep the card look the Base UI version had; the bouncy rows
						// animate their own radii, so no rounding class here.
						item: "border-none bg-muted/50 dark:bg-white/5",
						trigger: "px-4 py-3",
						title: "font-semibold text-[15px] leading-6",
						description: "px-1 text-[15px] text-muted-foreground",
					}}
					items={accordionItems}
				/>
			</div>
		</div>
	);
}
