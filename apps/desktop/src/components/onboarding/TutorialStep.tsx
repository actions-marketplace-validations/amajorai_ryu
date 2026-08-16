import {
	Message01Icon,
	ServerStack01Icon,
	Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button";
import { PageHeader } from "@ryu/ui/components/page-header";
import { motion } from "framer-motion";

const TIPS: { icon: IconSvgElement; title: string; description: string }[] = [
	{
		icon: Message01Icon,
		title: "Workspace: start with chat",
		description:
			"Chat is the simplest Runnable. Ask anything, pick an agent, and your conversation history lives here alongside Spaces and Memory.",
	},
	{
		icon: Wrench01Icon,
		title: "Build: agents, tools, workflows",
		description:
			"Create and configure agents, wire up tools, and compose workflows. Everything in Build turns into a Runnable you can invoke from chat.",
	},
	{
		icon: ServerStack01Icon,
		title: "Infra: engines and services",
		description:
			"Manage the local engines and sidecars that power your agents. Swap providers without touching any agent config.",
	},
];

export function TutorialStep({
	onContinue,
	onOpenExtensions,
}: {
	onContinue: () => void;
	onOpenExtensions: () => void;
}) {
	return (
		<div
			className="flex flex-col items-center gap-8"
			data-tauri-drag-region="false"
		>
			{/* max-w-md: the removed `animate` branch of PageHeader carried this on
			    the subtitle itself, and this centring column sets no width of its
			    own — without it the sentence stretches to the shell's full width. */}
			<PageHeader
				className="max-w-md"
				subtitle="The sidebar is grouped by purpose. Here is what each section is for."
				title="Three sections, one idea"
			/>

			<motion.div
				animate={{ opacity: 1, y: 0 }}
				className="flex w-full max-w-sm flex-col gap-4"
				initial={{ opacity: 0, y: 20 }}
				transition={{ delay: 0.4, duration: 0.5 }}
			>
				{TIPS.map(({ icon, title, description }, i) => (
					<motion.div
						animate={{ opacity: 1, x: 0 }}
						className="flex items-start gap-3"
						initial={{ opacity: 0, x: -10 }}
						key={title}
						transition={{ delay: 0.5 + i * 0.1, duration: 0.4 }}
					>
						<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
							<HugeiconsIcon className="size-4 text-primary" icon={icon} />
						</div>
						<div>
							<p className="font-medium text-sm">{title}</p>
							<p className="mt-0.5 text-muted-foreground text-xs">
								{description}
							</p>
						</div>
					</motion.div>
				))}
			</motion.div>

			<motion.div
				animate={{ opacity: 1, y: 0 }}
				className="flex w-full max-w-sm flex-col gap-3 rounded-3xl bg-card p-4"
				initial={{ opacity: 0, y: 10 }}
				transition={{ delay: 0.9, duration: 0.4 }}
			>
				<div>
					<p className="font-medium text-sm">Extend Ryu when you’re ready</p>
					<p className="mt-0.5 text-muted-foreground text-xs">
						Browse installed and available extensions from the Store. You can
						come back to this later from Settings.
					</p>
				</div>
				<div className="flex justify-end gap-2">
					<Button onClick={onOpenExtensions} size="sm" variant="ghost">
						Explore extensions
					</Button>
					<Button onClick={onContinue} size="sm">
						Continue to Ryu
					</Button>
				</div>
			</motion.div>
		</div>
	);
}
