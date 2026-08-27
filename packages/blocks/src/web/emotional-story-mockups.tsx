import { cn } from "@ryu/ui/lib/utils";
import {
	Check,
	CircleDollarSign,
	FolderOpen,
	ScrollText,
	ShieldCheck,
	X,
} from "lucide-react";
import { AppShell, MinimalCard } from "./mockups.tsx";

function StatusDot({ tone }: { tone: "ok" | "warn" | "bad" | "idle" }) {
	const styles = {
		ok: "bg-success",
		warn: "bg-warning",
		bad: "bg-destructive",
		idle: "bg-foreground/25",
	};
	return (
		<span className={cn("size-1.5 shrink-0 rounded-full", styles[tone])} />
	);
}

/** Generic chatbot: the conversation stops before the work begins. */
export function ChatbotOnlyMock() {
	return (
		<MinimalCard contentClassName="space-y-3">
			<div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-sm bg-foreground px-3 py-2 text-[11px] text-background">
				Summarize this PDF and draft the follow-up email
			</div>
			<div className="max-w-[92%] rounded-2xl rounded-tl-sm border border-border bg-muted/40 px-3 py-2 text-[11px] text-foreground/75">
				Here's a summary… (paste into Gmail yourself)
			</div>
			<div className="rounded-lg border border-border border-dashed bg-muted/20 px-3 py-2 text-center text-[10px] text-muted-foreground">
				No audit trail · no tool access · no approval path
			</div>
		</MinimalCard>
	);
}

/** Gateway audit — the leak that never happened. */
export function AuditSafetyMock() {
	const rows = [
		{
			label: "SSN in prompt",
			detail: "redacted before egress",
			tone: "warn" as const,
		},
		{
			label: "Tool: read_file",
			detail: "allowlisted · sandboxed",
			tone: "ok" as const,
		},
		{ label: "Budget", detail: "$12 / $200 cap", tone: "ok" as const },
	];
	return (
		<MinimalCard contentClassName="space-y-3">
			<div className="flex items-center gap-2">
				<ShieldCheck className="size-4 text-muted-foreground" />
				<p className="font-medium text-foreground text-xs">Every call logged</p>
			</div>
			{rows.map((row) => (
				<div
					className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2"
					key={row.label}
				>
					<StatusDot tone={row.tone} />
					<div className="min-w-0 flex-1">
						<p className="font-medium text-foreground text-xs">{row.label}</p>
						<p className="text-[10px] text-muted-foreground">{row.detail}</p>
					</div>
				</div>
			))}
		</MinimalCard>
	);
}

/** Keep the models a startup already uses, with a local option when needed. */
export function InstallLocalMock() {
	const models = [
		{ name: "ChatGPT", sub: "existing subscription", installed: true },
		{ name: "Claude", sub: "existing subscription", installed: false },
		{ name: "Ryu local", sub: "private fallback", installed: false },
	];
	return (
		<MinimalCard contentClassName="space-y-3">
			<div className="flex items-center justify-between rounded-lg bg-success/10 px-3 py-2">
				<span className="text-[11px] text-success">
					gemma-4 running locally · :8080
				</span>
				<span className="font-mono text-[10px] text-success/80">
					0 API keys
				</span>
			</div>
			<div className="space-y-2">
				{models.map((model) => (
					<div
						className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5"
						key={model.name}
					>
						<div>
							<p className="font-medium text-foreground text-xs">
								{model.name}
							</p>
							<p className="text-[10px] text-muted-foreground">{model.sub}</p>
						</div>
						<span
							className={cn(
								"rounded-md px-2 py-1 font-medium text-[10px]",
								model.installed
									? "bg-foreground text-background"
									: "border border-border text-foreground/60"
							)}
						>
							{model.installed ? "Connected" : "Connect"}
						</span>
					</div>
				))}
			</div>
		</MinimalCard>
	);
}

/** Demo dies in the room — security questions + folder called later. */
export function DemoDeathMock() {
	const blockers = [
		"Can you prove it's safe?",
		"What will this cost?",
		"Who maintains it?",
	];
	return (
		<AppShell active="Chat" nav={["Chat", "Trust", "Runs", "Spaces"]}>
			<div className="space-y-3">
				<div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-border bg-card px-3 py-2 text-[11px] text-foreground/80">
					Refactored auth. Tests pass on my machine.
				</div>
				<div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
					<p className="font-medium text-[11px] text-destructive">
						Security review
					</p>
					<ul className="mt-2 space-y-1.5">
						{blockers.map((q) => (
							<li
								className="flex items-center gap-2 text-[10px] text-foreground/75"
								key={q}
							>
								<X
									className="size-3 shrink-0 text-destructive"
									strokeWidth={2}
								/>
								{q}
							</li>
						))}
					</ul>
				</div>
				<div className="flex items-center gap-2 rounded-lg border border-border border-dashed bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
					<FolderOpen className="size-3.5 shrink-0" />
					<span className="font-mono">~/projects/later/</span>
				</div>
			</div>
		</AppShell>
	);
}

/** Trust receipt — the controls a startup needs before it ships the output. */
export function TrustReceiptMock() {
	return (
		<MinimalCard contentClassName="space-y-4">
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-3">
					<div className="flex items-center gap-2">
						<ScrollText className="size-4 text-muted-foreground" />
						<p className="font-medium text-foreground text-xs">What happened</p>
					</div>
					<p className="font-mono text-[10px] text-muted-foreground">
						req_8f2a · logged · allowed
					</p>
					<p className="font-mono text-[10px] text-muted-foreground">
						tool_exec · ghost.snapshot · allowed
					</p>
					<p className="font-mono text-[10px] text-muted-foreground">
						pii_scan · 2 fields redacted
					</p>
				</div>
				<div className="space-y-3">
					<div className="flex items-center gap-2">
						<CircleDollarSign className="size-4 text-muted-foreground" />
						<p className="font-medium text-foreground text-xs">Cost</p>
					</div>
					<p className="text-[11px] text-muted-foreground tabular-nums">
						$48 / $200
					</p>
					<div className="h-2 overflow-hidden rounded-full bg-muted">
						<div className="h-full w-[24%] rounded-full bg-foreground" />
					</div>
					<p className="text-[10px] text-success">Under cap · no surprises</p>
				</div>
			</div>
			<p className="text-center font-medium text-[11px] text-foreground">
				Ready for your team to review
			</p>
		</MinimalCard>
	);
}

/** First-run path — connect context → review → first real task. */
export function SevenMinuteMock() {
	const steps = [
		{ label: "Connect approved context", done: true },
		{ label: "Set the review points", done: true },
		{ label: "Run the first real task", done: true },
	];
	return (
		<AppShell active="Chat" nav={["Chat", "Context", "History", "Access"]}>
			<div className="space-y-3">
				<div className="flex items-center justify-between rounded-lg bg-foreground px-3 py-2 text-background">
					<span className="font-medium text-[11px]">first run complete</span>
					<span className="font-mono text-[10px] text-background/80">
						gateway on
					</span>
				</div>
				<div className="space-y-1.5">
					{steps.map((step) => (
						<div
							className="flex items-center gap-2 text-[10px]"
							key={step.label}
						>
							<Check className="size-3 text-success" strokeWidth={2.5} />
							<span className="text-foreground/80">{step.label}</span>
						</div>
					))}
				</div>
				<div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-sm bg-foreground px-3 py-2 text-[11px] text-background">
					Triage overnight support tickets
				</div>
				<div className="max-w-[92%] rounded-2xl rounded-tl-sm border border-border bg-card px-3 py-2 text-[11px] text-foreground/80">
					12 tickets classified · 3 escalated · draft replies ready
				</div>
			</div>
		</AppShell>
	);
}

/** Still running Monday — the win that sticks. */
export function StillRunningMock() {
	return (
		<AppShell active="Runs" nav={["Chat", "Context", "History", "Audit"]}>
			<div className="space-y-3">
				<div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
					<div>
						<p className="font-mono text-foreground text-xs">support-triage</p>
						<p className="text-[10px] text-muted-foreground">
							overnight run · governed
						</p>
					</div>
					<span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-1 text-[10px] text-success">
						<StatusDot tone="ok" />
						running
					</span>
				</div>
				<div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
					<p className="font-medium text-[10px] text-muted-foreground uppercase tracking-widest">
						Last audit scan
					</p>
					<p className="mt-1 text-foreground text-xs">
						No leaks · budget respected
					</p>
				</div>
				<p className="text-center text-[10px] text-muted-foreground">
					Works with everything. Locked to nothing.
				</p>
			</div>
		</AppShell>
	);
}
