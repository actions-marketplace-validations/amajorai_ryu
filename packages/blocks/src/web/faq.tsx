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
		title: "What does Ryu actually do for my firm?",
		content: [
			"We take a document-heavy workflow your team is spending its week on \u2014 translation jobs, claims files, working paper prep \u2014 and set it up to run with AI, configured around your document types, your rules and your approval steps.",
			"Your people move from typing to reviewing, and every job comes with a record of what was done.",
		],
	},
	{
		id: "2",
		title: "Do our client files leave the office?",
		content: [
			"Not unless you choose that. Ryu runs on your own machines, so the work can stay entirely inside the firm.",
			"If a job does call an outside model, personal details are stripped out first by default, and you can see exactly which jobs did so.",
		],
	},
	{
		id: "3",
		title: "How do we know what it did?",
		content: [
			"Every action is written down as it happens: what it read, what it produced, who approved it and what it cost. It reads as plain steps, not developer logs.",
			"That is the record you show a client or a regulator when they ask why the file looks the way it does.",
		],
	},
	{
		id: "4",
		title: "What does it cost, and can the bill run away from us?",
		content: [
			"Plans start at $39 per person per month, and you set a spending ceiling per person and per team on top of that. Work stops at the ceiling rather than quietly billing past it.",
			"Routine work runs on your own machines at no per-job cost, so the expensive models are only used when a job genuinely needs one.",
		],
	},
	{
		id: "5",
		title: "Can we get government funding for this?",
		content: [
			"Singapore SMEs can apply for co-funding on this kind of deployment through the national grant schemes. Support levels, caps and eligibility are set by the administering agency, not by us.",
			"We will walk through what your firm is likely to qualify for on the first call, before you commit to anything.",
		],
	},
	{
		id: "6",
		title: "What happens when our rules change?",
		content: [
			"You update the rule in one place and both your team and the agents work off the new version from that point. Older versions are kept, so you can see what was in force on the day a job ran.",
			"Corrections your reviewers make are kept too, which is why the work gets more accurate the longer you run it.",
		],
	},
	{
		id: "7",
		title: "Do we need someone technical on staff?",
		content: [
			"No. We set up the first workflow with you, and there is nothing to configure to keep it running. If you would rather not host it at all, we can run it for you under the same limits.",
		],
	},
	{
		id: "8",
		title: "Can we keep using ChatGPT or Claude?",
		content: [
			"Yes. Ryu runs any of them, plus Gemini, local models and agents you already built. We are not asking you to replace what your team likes \u2014 we make it safe to point at client files.",
		],
	},
	{
		id: "9",
		title: "Who is Ryu for?",
		content: [
			"Document-heavy firms in accounting, insurance, legal and translation \u2014 anywhere a person has to sign off on work built from sensitive client material.",
			"The same app runs locally for individuals, but the product we sell and support is the firm deployment.",
		],
	},
	{
		id: "10",
		title: "Which AI models does Ryu support?",
		content: [
			"OpenAI, Anthropic, Gemini, local models via Ollama or compatible runtimes, and 400+ models through supported providers. Switching models does not change how your workflow is set up.",
		],
	},
	{
		id: "11",
		title: "Is Ryu open source?",
		content: [
			"Ryu follows an open-core model. The core and gateway are self-hostable, while the desktop app, managed cloud and business features are commercial. You keep the option to leave.",
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
