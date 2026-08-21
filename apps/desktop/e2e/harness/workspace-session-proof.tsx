import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	parseWorkspaceSessionState,
	sameWorkspaceSessionState,
	type WorkspaceSessionDock,
	type WorkspaceSessionState,
} from "../../src/lib/workspace-session.ts";
import "../../src/index.css";

const STORAGE_KEY = "ryu-workspace-session-proof";

const EXPECTED_SESSION: WorkspaceSessionState = {
	bottom: {
		activeIndex: 1,
		tabs: [
			{
				kind: "terminal",
				label: "Terminal",
				pinned: true,
				project: true,
				uid: "project-terminal",
			},
			{ kind: "codereview", label: "Code Review" },
		],
	},
	bottomOpen: true,
	right: {
		activeIndex: 2,
		tabs: [
			{
				kind: "files",
				label: "Files",
				pinned: true,
				project: true,
				uid: "project-files",
			},
			{ kind: "sources", label: "Sources" },
			{ kind: "subagents", label: "Subagents" },
		],
	},
	rightOpen: true,
};

function readSavedSession(): WorkspaceSessionState | undefined {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return;
		}
		const parsed = JSON.parse(raw) as { workspaceSession?: unknown };
		return parseWorkspaceSessionState(parsed.workspaceSession);
	} catch {
		return;
	}
}

function DockCard({
	dock,
	label,
	open,
}: {
	dock: WorkspaceSessionDock;
	label: string;
	open: boolean;
}) {
	return (
		<section
			aria-label={`${label} workspace dock`}
			className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
		>
			<div className="flex items-center justify-between gap-4">
				<div>
					<p className="font-semibold text-lg">{label} dock</p>
					<p className="mt-1 text-slate-400 text-sm">
						{dock.tabs.length} open tabs · selected tab is restored by identity
					</p>
				</div>
				<span
					className={`rounded-full px-3 py-1 font-semibold text-xs ${open ? "bg-emerald-400/15 text-emerald-200" : "bg-slate-400/15 text-slate-300"}`}
					data-testid={`${label.toLowerCase()}-dock-state`}
				>
					{open ? "Open" : "Closed"}
				</span>
			</div>
			<ul className="mt-4 grid gap-2 sm:grid-cols-2">
				{dock.tabs.map((tab, index) => (
					<li
						className={`rounded-xl border px-3 py-3 ${index === dock.activeIndex ? "border-cyan-300/70 bg-cyan-300/10" : "border-white/10 bg-black/10"}`}
						data-active={index === dock.activeIndex ? "true" : "false"}
						data-testid={`${label.toLowerCase()}-tab-${index}`}
						key={`${tab.kind}-${tab.label}-${index}`}
					>
						<div className="flex items-center justify-between gap-3">
							<span className="font-medium text-sm">{tab.label}</span>
							{index === dock.activeIndex && (
								<span className="font-semibold text-cyan-200 text-xs">
									Selected
								</span>
							)}
						</div>
						<p className="mt-1 text-slate-400 text-xs">
							{tab.project ? "Project workspace tab" : "Chat workspace tab"}
							{tab.pinned ? " · pinned" : ""}
						</p>
					</li>
				))}
			</ul>
		</section>
	);
}

function WorkspaceSessionProof() {
	const [session, setSession] = useState<WorkspaceSessionState | undefined>(
		EXPECTED_SESSION
	);
	const [status, setStatus] = useState("Demo chat ready");
	const [activity, setActivity] = useState<string[]>([]);

	useEffect(() => {
		const saved = readSavedSession();
		if (saved) {
			setSession(saved);
			setStatus("Restored from saved chat session");
			setActivity(["Browser loaded the persisted chat snapshot"]);
		}
	}, []);

	const proofPassed =
		status === "Restored from saved chat session" &&
		sameWorkspaceSessionState(session, EXPECTED_SESSION);
	const totalTabs = useMemo(
		() =>
			session ? session.bottom.tabs.length + session.right.tabs.length : 0,
		[session]
	);

	const saveSession = () => {
		if (!session) {
			return;
		}
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ workspaceSession: session })
		);
		setStatus("Session saved");
		setActivity((current) => [
			"Saved all workspace tabs to the chat session",
			...current,
		]);
	};

	const simulateRelaunch = () => {
		setSession(undefined);
		const restored = readSavedSession();
		setSession(restored);
		setStatus(restored ? "Restored from saved chat session" : "Restore failed");
		setActivity((current) => [
			"Reopened the chat and restored its workspace snapshot",
			...current,
		]);
	};

	const reset = () => {
		localStorage.removeItem(STORAGE_KEY);
		setSession(EXPECTED_SESSION);
		setStatus("Demo chat ready");
		setActivity([]);
	};

	return (
		<main className="min-h-screen bg-[#0b0f14] p-6 text-slate-100 sm:p-10">
			<div className="mx-auto flex max-w-5xl flex-col gap-6">
				<header className="flex flex-col gap-4 border-white/10 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<p className="font-medium text-slate-400 text-xs uppercase tracking-[0.18em]">
							React verification artifact
						</p>
						<h1 className="mt-2 font-semibold text-3xl tracking-tight">
							Chat workspace tabs survive relaunch
						</h1>
						<p className="mt-2 max-w-2xl text-slate-400 text-sm leading-6">
							This proof uses the production workspace-session parser and
							compares a saved chat snapshot after a browser reload. It covers
							every open tab, selected tab, dock visibility, and project pin
							state.
						</p>
					</div>
					<div
						className={`rounded-full px-4 py-2 font-semibold text-sm ${proofPassed ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-400/15 text-amber-200"}`}
						data-testid="proof-status"
					>
						{proofPassed ? "PASS · full workspace restored" : status}
					</div>
				</header>

				<section
					className="grid gap-3 sm:grid-cols-3"
					data-testid="proof-controls"
				>
					<button
						className="rounded-xl bg-cyan-300 px-4 py-3 font-semibold text-[#071017] text-sm transition hover:bg-cyan-200"
						data-testid="save-session"
						onClick={saveSession}
						type="button"
					>
						Save chat session
					</button>
					<button
						className="rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 font-semibold text-sm transition hover:bg-white/10"
						data-testid="relaunch-session"
						onClick={simulateRelaunch}
						type="button"
					>
						Simulate relaunch
					</button>
					<button
						className="rounded-xl border border-white/15 px-4 py-3 font-semibold text-slate-300 text-sm transition hover:bg-white/[0.06]"
						data-testid="reset-session"
						onClick={reset}
						type="button"
					>
						Reset proof
					</button>
				</section>

				<section
					className="grid gap-3 sm:grid-cols-3"
					data-testid="proof-summary"
				>
					<div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
						<p className="text-slate-400 text-xs uppercase tracking-wide">
							Chat state
						</p>
						<p className="mt-2 font-semibold text-lg" data-testid="chat-state">
							{status}
						</p>
					</div>
					<div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
						<p className="text-slate-400 text-xs uppercase tracking-wide">
							Open tabs
						</p>
						<p className="mt-2 font-semibold text-lg" data-testid="tab-count">
							{totalTabs} across two docks
						</p>
					</div>
					<div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
						<p className="text-slate-400 text-xs uppercase tracking-wide">
							Session storage
						</p>
						<p className="mt-2 font-semibold text-lg">Per-chat snapshot</p>
					</div>
				</section>

				<div className="grid gap-5 lg:grid-cols-2">
					<DockCard
						dock={session?.bottom ?? { activeIndex: 0, tabs: [] }}
						label="Bottom"
						open={session?.bottomOpen ?? false}
					/>
					<DockCard
						dock={session?.right ?? { activeIndex: 0, tabs: [] }}
						label="Right"
						open={session?.rightOpen ?? false}
					/>
				</div>

				<section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
					<div className="flex items-center justify-between gap-4">
						<h2 className="font-semibold text-lg">Browser activity</h2>
						<span className="text-slate-400 text-xs">
							localStorage → parser → React
						</span>
					</div>
					<ul
						className="mt-3 space-y-2 text-slate-300 text-sm"
						data-testid="activity-log"
					>
						{activity.length === 0 ? (
							<li className="text-slate-500">No relaunch yet</li>
						) : (
							activity.map((entry, index) => (
								<li key={`${entry}-${index}`}>• {entry}</li>
							))
						)}
					</ul>
				</section>
			</div>
		</main>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<WorkspaceSessionProof />
);
