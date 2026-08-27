import { Logo } from "@ryu/ui/components/logo";
import { cn } from "@ryu/ui/lib/utils";
import {
	Check,
	ChevronDown,
	CirclePlus,
	Mic,
	Search,
	Send,
} from "lucide-react";
import ProductLandingCtas from "./product-landing-ctas.tsx";

function BotAppVisual() {
	const bots = [
		["Weekly report", "drafted the update from the project...", "#4fd1c5"],
		["Client follow-up", "reply ready for your approval...", "#f59e0b"],
		["Inbox cleanup", "sorted 18 messages; 5 need you...", "#7367f0"],
		["Meeting notes", "summary and owners are ready...", "#8b5cf6"],
		["Research brief", "pulled sources and flagged gaps...", "#3b82f6"],
		["Expense review", "9 receipts matched to the report...", "#f97316"],
		["Team handoff", "the next steps are ready to share...", "#4fd1c5"],
	] as const;

	return (
		<div className="mx-auto w-full max-w-5xl overflow-hidden rounded-2xl bg-[#f1f1ef] text-foreground/80 ring-1 ring-black/10">
			<div className="grid min-h-[35rem] md:grid-cols-[18rem_1fr]">
				<aside className="border-black/10 border-r bg-[#e8e8e5] p-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2 text-foreground/80 text-sm">
							<Logo className="text-foreground" size="22px" variant="outline" />
							<span>Ryu Bot</span>
						</div>
						<CirclePlus className="size-4 text-foreground/45" />
					</div>
					<div className="mt-4 flex items-center gap-2 rounded-lg bg-white/65 px-3 py-2 text-foreground/40 text-xs">
						<Search className="size-3.5" /> Search
					</div>
					<div className="mt-4 space-y-1.5">
						{bots.map(([name, preview, color], index) => (
							<div
								className={cn(
									"flex items-center gap-2.5 rounded-lg px-2 py-2",
									index === 1 && "bg-white/65"
								)}
								key={name}
							>
								<span
									className="flex size-8 shrink-0 items-center justify-center rounded-full text-black text-xs"
									style={{ backgroundColor: color }}
								>
									{name.slice(0, 1)}
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-foreground/75 text-xs">
										{name}
									</span>
									<span className="block truncate text-[10px] text-foreground/40">
										{preview}
									</span>
								</span>
								<span className="text-[10px] text-foreground/30">
									{index + 1}:18
								</span>
							</div>
						))}
					</div>
					<div className="mt-auto flex items-center gap-2 pt-8 text-foreground/50 text-xs">
						<span className="flex size-7 items-center justify-center rounded-full bg-white/70">
							AS
						</span>
						Armand Segall
					</div>
				</aside>

				<section className="flex min-w-0 flex-col bg-[#f8f8f6]">
					<div className="flex items-center gap-2 border-black/10 border-b px-5 py-4 text-foreground/80 text-sm">
						<span className="flex size-7 items-center justify-center rounded-full bg-[#f59e0b] text-black text-xs">
							N
						</span>
						Weekly report
						<ChevronDown className="size-3.5 text-foreground/35" />
					</div>
					<div className="flex flex-1 flex-col justify-between p-5 md:p-7">
						<div>
							<p className="text-center text-foreground/40 text-xs">9:19 PM</p>
							<div className="mt-5 max-w-xl rounded-2xl bg-[#e7e7e5] px-4 py-3 text-foreground/80 text-sm leading-relaxed">
								I pulled the project notes, compared the changes, and drafted
								this week's update. Review it before I send it.
							</div>
							<div className="mt-4 flex items-center gap-2 text-foreground/40 text-xs">
								<Check className="size-3 text-emerald-600" /> Ready to work
							</div>
						</div>
						<div className="flex items-center gap-3 rounded-full bg-white px-4 py-3 text-foreground/40 text-sm ring-1 ring-black/10">
							<span className="flex size-6 items-center justify-center rounded-full bg-black/5">
								+
							</span>
							<span className="flex-1">Message Ryu Bot</span>
							<Mic className="size-4" />
							<Send className="size-4" />
						</div>
					</div>
				</section>
			</div>
		</div>
	);
}

export default function BotLanding() {
	return (
		<main
			className="min-h-screen bg-white text-foreground"
			data-testid="bot-landing"
		>
			<section className="mx-auto flex max-w-6xl flex-col items-center px-6 pt-16 pb-20 text-center md:pt-24 md:pb-28">
				<h1 className="mt-0 flex max-w-5xl items-center justify-center gap-4 text-balance font-medium text-5xl text-foreground leading-none tracking-[-0.06em] md:text-7xl">
					<Logo
						className="shrink-0 text-foreground"
						size="64px"
						variant="outline"
					/>
					<span>Give AI a job, not a setup</span>
				</h1>
				<p className="mt-7 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed md:text-xl">
					For teams already using ChatGPT or Claude but still doing the checking
					and copy-paste themselves. Ryu Bot takes the task, works in its own
					computer, and brings back a result you can review.
				</p>
				<ProductLandingCtas className="mt-8" />
				<div className="mt-16 w-full">
					<BotAppVisual />
				</div>
			</section>

			<section className="mx-auto grid max-w-6xl gap-3 border-black/10 border-t px-6 py-20 md:grid-cols-3 md:py-28">
				{[
					[
						"Start with a task",
						"Send a request in plain language and keep the same thread going.",
					],
					[
						"It has a computer",
						"Ryu Bot works in a private computer and sandbox while you are away.",
					],
					[
						"Approve the important parts",
						"Choose what it can read, change, or send before it acts.",
					],
				].map(([title, description]) => (
					<div className="rounded-2xl bg-muted/50 p-5" key={title}>
						<h2 className="font-medium text-foreground text-lg">{title}</h2>
						<p className="mt-3 text-muted-foreground text-sm leading-relaxed">
							{description}
						</p>
					</div>
				))}
			</section>
		</main>
	);
}
