import { cn } from "@ryu/ui/lib/utils";
import {
	Check,
	Computer,
	FileCheck2,
	LockKeyhole,
	MousePointer2,
	Sparkles,
} from "lucide-react";
import { landingCardSurfaceClass } from "./landing-card-tones.ts";
import { Reveal } from "./reveal.tsx";
import { sectionSubtitleClass } from "./sections.tsx";

function FeatureVisual({ kind }: { kind: "computer" | "permission" | "task" }) {
	if (kind === "task") {
		return (
			<div className={cn(landingCardSurfaceClass("purple"), "h-auto min-h-72")}>
				<div className="flex items-center gap-2 text-[#4c1d95] text-xs">
					<Sparkles className="size-4" />
					Ryu Bot
				</div>
				<div className="mt-8 ml-auto max-w-[84%] rounded-xl bg-background/60 px-3 py-2 text-[#4c1d95] text-[11px]">
					Turn these notes into a client update.
				</div>
				<div className="mt-3 max-w-[90%] rounded-xl bg-background/65 px-3 py-3 text-[#5b21b6]/90 text-[11px] leading-relaxed">
					<p>Done. The draft is ready, with the source files attached.</p>
					<div className="mt-3 flex flex-wrap gap-1.5">
						<span className="flex items-center gap-1.5 rounded-md bg-[#ede9fe] px-2 py-1 text-[#4c1d95] text-[10px]">
							<FileCheck2 className="size-3" /> 3 files used
						</span>
						<span className="flex items-center gap-1.5 rounded-md bg-[#ede9fe] px-2 py-1 text-[#4c1d95] text-[10px]">
							<Check className="size-3" /> Ready to review
						</span>
					</div>
				</div>
			</div>
		);
	}

	if (kind === "computer") {
		return (
			<div className={cn(landingCardSurfaceClass("blue"), "h-auto min-h-72")}>
				<div className="flex items-center justify-between gap-3 text-[#1e3a5f] text-xs">
					<span className="flex items-center gap-2">
						<Computer className="size-4" /> Ryu’s computer
					</span>
					<MousePointer2 className="size-3.5 text-[#1d4ed8]/70" />
				</div>
				<div className="mt-6 rounded-xl bg-background/55 p-3">
					<div className="flex items-center gap-1.5 border-[#1e3a5f]/10 border-b pb-2 text-[#1e3a5f]/60 text-[10px]">
						<span className="size-2 rounded-full bg-[#60a5fa]/70" />
						<span className="size-2 rounded-full bg-[#93c5fd]/70" />
						<span className="ml-1">working</span>
					</div>
					<div className="space-y-3 pt-4">
						{[
							["Open project files", "Done"],
							["Draft the update", "Done"],
							["Send it", "Waiting"],
						].map(([label, status], index) => (
							<div className="flex items-center gap-2" key={label}>
								{index === 2 ? (
									<LockKeyhole className="size-3 text-amber-600" />
								) : (
									<Check className="size-3 text-emerald-600" />
								)}
								<span className="flex-1 text-[#1e3a5f]/80 text-[10px]">
									{label}
								</span>
								<span className="text-[#1e3a5f]/55 text-[10px]">{status}</span>
							</div>
						))}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className={cn(landingCardSurfaceClass("orange"), "h-auto min-h-72")}>
			<div className="flex items-center gap-2 text-[#5c3608] text-xs">
				<LockKeyhole className="size-4" />
				Your computer
			</div>
			<div className="mt-8 space-y-3">
				{[
					{
						detail: "Allowed for this task",
						enabled: true,
						label: "Screen access",
					},
					{
						detail: "Ask every time",
						enabled: true,
						label: "Keyboard and mouse",
					},
					{ detail: "Always ask", enabled: false, label: "Send or delete" },
				].map((permission) => (
					<div
						className="flex items-center justify-between gap-4 rounded-xl bg-background/50 px-3 py-2.5"
						key={permission.label}
					>
						<div>
							<p className="font-medium text-[#5c3608] text-[11px]">
								{permission.label}
							</p>
							<p className="mt-0.5 text-[#6d4210]/75 text-[10px]">
								{permission.detail}
							</p>
						</div>
						<span
							className={cn(
								"size-2 rounded-full",
								permission.enabled ? "bg-emerald-600" : "bg-amber-600"
							)}
						/>
					</div>
				))}
			</div>
		</div>
	);
}

const FEATURES = [
	{
		description:
			"Ask for an outcome in plain language. Ryu keeps the task, context, and result together.",
		kind: "task" as const,
		eyebrow: "Message Ryu like a teammate",
		title: "Give Ryu a task.",
	},
	{
		description:
			"Every task gets a private computer and sandbox. Ryu can work through the steps while you get on with your day.",
		kind: "computer" as const,
		eyebrow: "Ryu’s computer",
		title: "It works through the job.",
	},
	{
		description:
			"When the task needs your apps, Ryu asks first. You decide what it can see, click, change, or send.",
		kind: "permission" as const,
		eyebrow: "Your computer",
		title: "Use your tools when you allow it.",
	},
] as const;

export default function BotFeatureStory() {
	return (
		<section
			className="container mx-auto px-4 py-20 md:py-28"
			data-testid="bot-feature-story"
		>
			<div className="mx-auto max-w-6xl space-y-24 md:space-y-32">
				{FEATURES.map((feature, index) => (
					<div
						className="grid items-center gap-10 lg:grid-cols-2"
						key={feature.title}
					>
						<Reveal className={cn(index % 2 === 1 && "lg:order-2")}>
							<div className="max-w-lg">
								<p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.18em]">
									{feature.eyebrow}
								</p>
								<h2 className="mt-4 text-balance font-medium text-3xl text-foreground tracking-tight md:text-4xl">
									{feature.title}
								</h2>
								<p className={cn(sectionSubtitleClass, "mt-4")}>
									{feature.description}
								</p>
							</div>
						</Reveal>
						<Reveal className={cn(index % 2 === 1 && "lg:order-1")} delay={0.1}>
							<FeatureVisual kind={feature.kind} />
						</Reveal>
					</div>
				))}
			</div>
		</section>
	);
}
