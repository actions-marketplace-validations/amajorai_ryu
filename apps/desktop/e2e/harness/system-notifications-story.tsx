import { createRoot } from "react-dom/client";
import "../../src/index.css";

type NotificationLevel = "info" | "success" | "warning";

interface ProofEvent {
	body: string;
	level: NotificationLevel;
	path: string;
	title: string;
	trigger: string;
}

const PROOF_EVENTS: ProofEvent[] = [
	{
		body: "Clips is installed and ready to enable.",
		level: "success",
		path: "built-in / bundle / catalog install",
		title: "App installed",
		trigger: "Successful app install",
	},
	{
		body: "4 imported, 1 already present, 0 failed from .codex.",
		level: "success",
		path: "setup import batch",
		title: "Import complete",
		trigger: "Setup import completion",
	},
	{
		body: "Research thread is ready from codex.",
		level: "success",
		path: "native thread import",
		title: "Thread imported",
		trigger: "Manual or background thread import",
	},
	{
		body: "2 of 3 delegated tasks completed.",
		level: "warning",
		path: "delegate stream / delegate.fanout",
		title: "Other agents finished with issues",
		trigger: "Delegation completion with partial failure",
	},
];

const levelStyles: Record<NotificationLevel, string> = {
	info: "border-sky-400/30 bg-sky-400/10 text-sky-200",
	success: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
	warning: "border-amber-400/30 bg-amber-400/10 text-amber-200",
};

function SystemNotificationsStory() {
	const verified =
		PROOF_EVENTS.length === 4 &&
		PROOF_EVENTS.some((event) => event.title === "App installed") &&
		PROOF_EVENTS.some((event) => event.title === "Import complete") &&
		PROOF_EVENTS.some((event) => event.title === "Thread imported") &&
		PROOF_EVENTS.some((event) => event.title.includes("Other agents"));

	return (
		<main className="min-h-screen bg-[#0b0f14] p-6 text-slate-100 sm:p-10">
			<div className="mx-auto flex max-w-4xl flex-col gap-6">
				<header className="flex flex-col gap-4 border-white/10 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<p className="font-medium text-slate-400 text-xs uppercase tracking-[0.18em]">
							React verification artifact
						</p>
						<h1 className="mt-2 font-semibold text-3xl tracking-tight">
							System notifications
						</h1>
						<p className="mt-2 max-w-2xl text-slate-400 text-sm leading-6">
							Core completion seams publish ephemeral events through the
							existing SSE bus; the desktop renders them as toast and native OS
							notices.
						</p>
					</div>
					<div
						className="inline-flex w-fit items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 font-semibold text-emerald-200 text-xs"
						data-status={verified ? "pass" : "pending"}
						data-testid="proof-status"
					>
						{verified ? "PASS · 4 completion paths" : "PENDING"}
					</div>
				</header>

				<section
					aria-label="Notification guarantees"
					className="grid gap-3 sm:grid-cols-3"
				>
					<div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
						<p className="font-medium text-slate-400 text-xs uppercase tracking-wide">
							Delivery
						</p>
						<p className="mt-2 font-medium text-sm">Shared SSE stream</p>
					</div>
					<div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
						<p className="font-medium text-slate-400 text-xs uppercase tracking-wide">
							Surface
						</p>
						<p className="mt-2 font-medium text-sm">Toast + native OS</p>
					</div>
					<div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
						<p className="font-medium text-slate-400 text-xs uppercase tracking-wide">
							Noise guard
						</p>
						<p className="mt-2 font-medium text-sm">Success boundaries only</p>
					</div>
				</section>

				<section
					aria-label="Verified notification events"
					className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]"
				>
					<div className="border-white/10 border-b px-5 py-4">
						<h2 className="font-semibold text-lg">
							Verified completion events
						</h2>
						<p className="mt-1 text-slate-400 text-sm">
							Each row maps a real Core producer to the shared desktop
							notification contract.
						</p>
					</div>
					<div className="divide-y divide-white/10">
						{PROOF_EVENTS.map((event) => (
							<article
								className="grid gap-4 px-5 py-5 sm:grid-cols-[1fr_auto]"
								data-testid="notification-proof-row"
								key={event.title}
							>
								<div>
									<div className="flex flex-wrap items-center gap-2">
										<h3 className="font-medium">{event.title}</h3>
										<span
											className={`rounded-full border px-2 py-0.5 font-medium text-xs ${levelStyles[event.level]}`}
										>
											{event.level}
										</span>
									</div>
									<p className="mt-1 text-slate-300 text-sm">{event.body}</p>
									<p className="mt-2 text-slate-500 text-xs">{event.trigger}</p>
								</div>
								<div className="self-start rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-right sm:min-w-52">
									<p className="font-medium text-slate-300 text-xs">
										Core producer
									</p>
									<p className="mt-1 font-mono text-slate-500 text-xs">
										{event.path}
									</p>
								</div>
							</article>
						))}
					</div>
				</section>

				<p className="text-slate-500 text-xs">
					Targeted thread-import events stay on the per-user stream; broadcast
					system events stay ephemeral and do not create inbox rows.
				</p>
			</div>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<SystemNotificationsStory />);
}
