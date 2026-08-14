// apps/desktop/src/pages/PreflightPage.tsx
//
// The preflight / boot-health page. Shown when Core failed to come up (degraded);
// auto-advances into the app the moment Core reports running. It checks the four
// components — Core · Gateway · Desktop · Island — plus Core's sidecars, and
// gives each a status dot, version, "update available" action, and (auto-start
// plus a manual) Start/Restart control. A footer copies a diagnostics bundle or
// reports the issue through the wired, privacy-gated crash/analytics sinks.
//
// It runs BEFORE the main app shell, so it owns its own polling (no
// SystemStatusProvider above it) and targets the active node directly, degrading
// every probe to "unknown" when Core is unreachable.

import { Button } from "@ryu/ui/components/button";
import { Logo as GhostOrb } from "@ryu/ui/components/logo";
import { PageHeader } from "@ryu/ui/components/page-header";
import { toast } from "@ryu/ui/components/sileo";
import { StaggerReveal } from "@ryu/ui/components/stagger-reveal";
import { cn } from "@ryu/ui/lib/utils";
import { relaunch } from "@tauri-apps/plugin-process";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	getRyuStatus,
	restartRyuCore,
	startRyuCore,
} from "@/lib/tauri-bridge.ts";
import {
	BouncyAccordion,
	type BouncyAccordionItem,
} from "@/src/components/ui/bouncy-accordion.tsx";
import {
	applyReleaseUpdate,
	scheduleReleaseUpdate,
} from "@/src/components/updater/AutoUpdater.tsx";
import { useEngines } from "@/src/hooks/useEngines.ts";
import { type ApiTarget, toTarget } from "@/src/lib/api/client.ts";
import {
	applySafeMode,
	readSafeModeSentinel,
} from "@/src/lib/api/safe-mode.ts";
import {
	fetchHealth,
	fetchSystemStatus,
	restartGateway,
} from "@/src/lib/api/system.ts";
import { checkForUpdate, type UpdateCheck } from "@/src/lib/api/update.ts";
import { copyDiagnostics, reportIssue } from "@/src/lib/preflight.ts";
import { restartSidecar, startSidecar } from "@/src/lib/services-api.ts";
import { useAppStore } from "@/src/store/useAppStore.ts";
import { isLocalNode, useNodeStore } from "@/src/store/useNodeStore.ts";

/** The Island Electron companion's loopback control server (see apps/island). */
const ISLAND_CONTROL_URL = "http://127.0.0.1:7989/control";
const POLL_INTERVAL_MS = 2500;

type Tone = "ok" | "warn" | "bad" | "pending";

const TONE_CLASS: Record<Tone, string> = {
	ok: "bg-success",
	warn: "bg-warning",
	bad: "bg-destructive",
	pending: "bg-muted-foreground/40",
};

function StatusDot({ tone }: { tone: Tone }) {
	return (
		<span
			className={cn(
				"size-2 shrink-0 rounded-full",
				TONE_CLASS[tone],
				tone === "pending" && "animate-pulse"
			)}
		/>
	);
}

/** The full health snapshot the page polls into. */
interface Health {
	coreState: "running" | "starting" | "stopped";
	coreUpdate: UpdateCheck | null;
	coreVersion: string | null;
	gatewayReachable: boolean | null;
	islandReachable: boolean | null;
	loading: boolean;
	/** name -> running, from /api/system/status. */
	sidecars: { name: string; running: boolean }[];
}

const INITIAL_HEALTH: Health = {
	coreState: "starting",
	coreVersion: null,
	coreUpdate: null,
	gatewayReachable: null,
	islandReachable: null,
	loading: true,
	sidecars: [],
};

function activeTarget(): ApiTarget {
	try {
		return toTarget(useNodeStore.getState().getActiveNode());
	} catch {
		return { url: "http://127.0.0.1:7980", token: null };
	}
}

/** Probe the Island loopback control server; best-effort (may CORS-fail). */
async function probeIsland(): Promise<boolean> {
	try {
		const resp = await fetch(ISLAND_CONTROL_URL, { method: "GET" });
		return resp.ok;
	} catch {
		return false;
	}
}

function usePreflightHealth() {
	const [health, setHealth] = useState<Health>(INITIAL_HEALTH);
	const setCoreStatus = useAppStore((s) => s.setCoreStatus);
	const autoStarted = useRef(false);

	const poll = useCallback(async () => {
		const target = activeTarget();
		const status = await getRyuStatus().catch(() => "stopped");
		const coreRunning = status === "running";

		// Auto-start Core once if it is down — the "auto-start if it fails" ask.
		if (!(coreRunning || autoStarted.current)) {
			autoStarted.current = true;
			startRyuCore().catch(() => undefined);
		}

		if (!coreRunning) {
			const island = await probeIsland();
			setHealth((h) => ({
				...h,
				coreState: "stopped",
				gatewayReachable: null,
				islandReachable: island,
				loading: false,
			}));
			return;
		}

		// Core is up — the app gate can advance; fan out the remaining probes.
		setCoreStatus("running");
		const [sys, health_, update, island] = await Promise.all([
			fetchSystemStatus(target).catch(() => null),
			fetchHealth(target).catch(() => null),
			checkForUpdate(target).catch(() => null),
			probeIsland(),
		]);
		setHealth({
			coreState: "running",
			coreVersion: health_?.version ?? null,
			coreUpdate: update,
			gatewayReachable: sys?.gatewayReachable ?? false,
			islandReachable: island,
			loading: false,
			sidecars: sys
				? Object.entries(sys.sidecars).map(([name, running]) => ({
						name,
						running,
					}))
				: [],
		});
	}, [setCoreStatus]);

	useEffect(() => {
		let cancelled = false;
		const tick = async () => {
			if (cancelled) {
				return;
			}
			await poll().catch(() => undefined);
		};
		tick();
		const id = setInterval(tick, POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [poll]);

	return { health, refresh: poll };
}

/** A labelled action button that shows a spinner label while its promise runs. */
function ActionButton({
	label,
	busyLabel,
	onRun,
	variant = "outline",
}: {
	label: string;
	busyLabel: string;
	onRun: () => Promise<void>;
	variant?: "default" | "outline";
}) {
	const [busy, setBusy] = useState(false);
	return (
		<Button
			disabled={busy}
			onClick={async () => {
				setBusy(true);
				try {
					await onRun();
				} finally {
					setBusy(false);
				}
			}}
			size="sm"
			variant={variant}
		>
			{busy ? busyLabel : label}
		</Button>
	);
}

export function PreflightPage({
	embedded = false,
}: {
	embedded?: boolean;
} = {}) {
	const { health, refresh } = usePreflightHealth();
	const { engines } = useEngines();
	const [open, setOpen] = useState<string | null>("core");
	// Safe Mode's on-disk sentinel. Read here rather than from Core because this
	// page's whole audience is nodes that may not be answering — and a "boot without
	// extensions" escape hatch that needs a healthy Core to reach is no escape hatch.
	const [safeModeArmed, setSafeModeArmed] = useState(false);
	// Re-read on the page's own cadence, not once on mount: Safe Mode can be armed
	// from Settings and this page reached without a remount, and a stale button
	// would offer "Restart in Safe Mode" on a node that is already in it.
	useEffect(() => {
		let cancelled = false;
		const tick = () => {
			readSafeModeSentinel().then((armed) => {
				if (!cancelled) {
					setSafeModeArmed(armed);
				}
			});
		};
		tick();
		const id = setInterval(tick, POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, []);

	const target = activeTarget();

	const coreTone: Tone =
		health.coreState === "running"
			? "ok"
			: health.coreState === "starting"
				? "pending"
				: "bad";
	const gatewayTone: Tone =
		health.gatewayReachable == null
			? "pending"
			: health.gatewayReachable
				? "ok"
				: "bad";
	// # 0.1.0: Island disabled — uncomment when re-enabling the Island accordion item
	// const islandTone: Tone =
	// 	health.islandReachable == null
	// 		? "pending"
	// 		: health.islandReachable
	// 			? "ok"
	// 			: "warn";
	// Hide engines that aren't installed, or that this node can't run (e.g. MLX on
	// non-Apple-Silicon), from the sidecar list. They're registered in the catalog
	// but never installed, so surfacing them as health rows just nags.
	const hiddenEngineNames = new Set(
		engines
			.filter((e) => !e.supported || e.installState === "not_installed")
			.map((e) => e.name)
	);
	const visibleSidecars = health.sidecars.filter(
		(s) => !hiddenEngineNames.has(s.name)
	);
	const failedSidecars = visibleSidecars.filter((s) => !s.running);

	const componentTitle = (
		name: string,
		tone: Tone,
		detail: string,
		badge?: string
	) => (
		<span className="flex min-w-0 items-center gap-2">
			<StatusDot tone={tone} />
			<span className="font-medium text-foreground">{name}</span>
			<span className="truncate text-muted-foreground text-xs">{detail}</span>
			{badge ? (
				<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
					{badge}
				</span>
			) : null}
		</span>
	);

	const coreUpdateAvailable = health.coreUpdate?.update_available ?? false;

	const items: BouncyAccordionItem[] = [
		{
			id: "core",
			title: componentTitle(
				"Core",
				coreTone,
				health.coreState === "running"
					? `running · v${health.coreVersion ?? "?"}`
					: health.coreState === "starting"
						? "starting…"
						: "not running",
				coreUpdateAvailable ? "Update" : undefined
			),
			description: (
				<div className="flex flex-col gap-3">
					<p>Ryu's brain. Chat, agents, and automations all need it running.</p>
					<div className="flex flex-wrap gap-2">
						{health.coreState === "running" ? null : (
							<ActionButton
								busyLabel="Starting…"
								label="Start Core"
								onRun={async () => {
									await startRyuCore();
									toast.info("Starting Core…");
								}}
								variant="default"
							/>
						)}
						<ActionButton
							busyLabel="Restarting…"
							label="Restart Core"
							onRun={async () => {
								await restartRyuCore();
								toast.info("Restarting Core…");
							}}
						/>
						{/* Safe Mode: restart with apps, plugins, skills, user MCP servers
						    and the scheduler switched off, to find out whether one of them
						    is what's wrong. Nothing is uninstalled — it only changes what
						    loads, so leaving it puts everything back. */}
						<ActionButton
							busyLabel={safeModeArmed ? "Restoring…" : "Arming…"}
							label={safeModeArmed ? "Leave Safe Mode" : "Restart in Safe Mode"}
							onRun={async () => {
								const next = !safeModeArmed;
								// Core first when it is up, so BOTH persistence tiers move
								// together — see `applySafeMode`.
								await applySafeMode(target, next);
								setSafeModeArmed(next);
								await restartRyuCore();
								toast.info(
									next
										? "Restarting in Safe Mode — apps, plugins and skills won't load"
										: "Restarting normally — apps, plugins and skills are back"
								);
							}}
						/>
						{coreUpdateAvailable && health.coreUpdate ? (
							<ActionButton
								busyLabel="Updating…"
								label="Update Core"
								onRun={async () => {
									// Routes to the node's OWN updater when this Core is
									// remote — the bundled desktop updater would otherwise
									// replace this machine's app and leave that node behind.
									const message = await applyReleaseUpdate(
										target,
										useNodeStore.getState().getActiveNode(),
										health.coreUpdate as UpdateCheck
									);
									if (message) {
										toast.info(message);
									}
								}}
								variant="default"
							/>
						) : null}
						{/* Only for a REMOTE node. A local node's Core ships inside this
						    app bundle and is installed by the native updater with its own
						    restart flow, so there is nothing on it to defer — offering the
						    choice there would be a button that always errors. */}
						{coreUpdateAvailable &&
						health.coreUpdate &&
						!isLocalNode(useNodeStore.getState().getActiveNode()) ? (
							<ActionButton
								busyLabel="Scheduling…"
								label="Update tonight"
								onRun={async () => {
									// Deferred to the NODE's quiet hour, not the viewer's:
									// the machine that restarts is the one whose night
									// matters. The confirmation names the zone.
									const message = await scheduleReleaseUpdate(
										target,
										useNodeStore.getState().getActiveNode(),
										health.coreUpdate as UpdateCheck
									);
									toast.info(message);
								}}
								variant="outline"
							/>
						) : null}
					</div>
					{health.coreState === "running" && visibleSidecars.length > 0 ? (
						<div className="flex flex-col gap-2 border-border/60 border-t pt-3">
							<span className="text-foreground text-xs">
								Helpers ({visibleSidecars.length - failedSidecars.length}/
								{visibleSidecars.length} running)
							</span>
							{visibleSidecars.map((sc) => (
								<div
									className="flex items-center justify-between gap-2"
									key={sc.name}
								>
									<span className="flex items-center gap-2 text-sm">
										<StatusDot tone={sc.running ? "ok" : "warn"} />
										{sc.name}
									</span>
									{sc.running ? (
										<ActionButton
											busyLabel="…"
											label="Restart"
											onRun={async () => {
												await restartSidecar(target.url, target.token, sc.name);
												toast.info(`Restarting ${sc.name}…`);
												await refresh();
											}}
										/>
									) : (
										<ActionButton
											busyLabel="…"
											label="Start"
											onRun={async () => {
												await startSidecar(target.url, target.token, sc.name);
												toast.info(`Starting ${sc.name}…`);
												await refresh();
											}}
										/>
									)}
								</div>
							))}
						</div>
					) : null}
				</div>
			),
		},
		{
			id: "gateway",
			title: componentTitle(
				"Gateway",
				gatewayTone,
				health.coreState === "running"
					? health.gatewayReachable
						? "connected"
						: "can't connect"
					: "waiting for Core"
			),
			description: (
				<div className="flex flex-col gap-3">
					<p>
						Keeps Ryu safe — what it can do, and how much it uses. Restart if it
						looks stuck.
					</p>
					<div className="flex flex-wrap gap-2">
						<ActionButton
							busyLabel="Restarting…"
							label="Restart Gateway"
							onRun={async () => {
								const ok = await restartGateway(target);
								toast[ok ? "info" : "warning"](
									ok
										? "Restarting Gateway…"
										: "Gateway can't be restarted from here"
								);
								await refresh();
							}}
						/>
					</div>
				</div>
			),
		},
		{
			id: "desktop",
			title: componentTitle("Desktop", "ok", "this app"),
			description: (
				<div className="flex flex-col gap-3">
					<p>This app. Relaunch if the window freezes or looks stuck.</p>
					<div className="flex flex-wrap gap-2">
						<ActionButton
							busyLabel="Relaunching…"
							label="Relaunch Desktop"
							onRun={() => relaunch()}
						/>
					</div>
				</div>
			),
		},
		// # 0.1.0: Island disabled — re-enable by uncommenting this block
		// {
		// 	id: "island",
		// 	title: componentTitle(
		// 		"Island",
		// 		islandTone,
		// 		health.islandReachable == null
		// 			? "checking…"
		// 			: health.islandReachable
		// 				? "running"
		// 				: "not running"
		// 	),
		// 	description: (
		// 		<div className="flex flex-col gap-3">
		// 			<p>
		// 				The floating companion at the top of your screen. Use Show to bring
		// 				it back if it's hidden.
		// 			</p>
		// 			<div className="flex flex-wrap gap-2">
		// 				<ActionButton
		// 					busyLabel="…"
		// 					label="Show Island"
		// 					onRun={async () => {
		// 						try {
		// 							await fetch(ISLAND_CONTROL_URL, {
		// 								method: "POST",
		// 								headers: { "Content-Type": "application/json" },
		// 								body: JSON.stringify({ action: "show" }),
		// 							});
		// 							toast.info("Showing Island…");
		// 						} catch {
		// 							toast.warning("Island isn't running");
		// 						}
		// 						await refresh();
		// 					}}
		// 				/>
		// 			</div>
		// 		</div>
		// 	),
		// },
	];

	const body = (
		<>
			<BouncyAccordion
				classNames={{ title: "truncate" }}
				items={items}
				onValueChange={setOpen}
				value={open}
			/>

			<div className="flex items-center justify-between gap-2">
				<div className="flex gap-2">
					<ActionButton
						busyLabel="Reporting…"
						label="Report issue"
						onRun={async () => {
							await reportIssue(target);
							toast.success("Issue reported");
						}}
						variant="default"
					/>
					<ActionButton
						busyLabel="Copying…"
						label="Copy diagnostics"
						onRun={async () => {
							await copyDiagnostics(target);
							toast.success("Diagnostics copied to clipboard");
						}}
					/>
				</div>
				{embedded ? (
					<Button onClick={() => refresh()} size="sm" variant="outline">
						Refresh
					</Button>
				) : health.coreState === "running" ? (
					<Button onClick={() => refresh()} size="sm" variant="default">
						Continue
					</Button>
				) : null}
			</div>
		</>
	);

	// Embedded (Settings) keeps a compact stack. Full-window boot matches Login /
	// onboarding: GhostOrb + PageHeader + staggered reveal.
	if (embedded) {
		return <div className="flex w-full flex-col gap-5">{body}</div>;
	}

	return (
		// Full-window boot screen renders outside Layout, so it has no TitleBar
		// drag region — mark the background draggable so the window can still be
		// moved. Interactive children override it.
		<div
			className="flex h-full w-full flex-col items-center justify-center gap-8 overflow-y-auto bg-background p-8"
			data-tauri-drag-region="true"
		>
			<StaggerReveal>
				<div className="shrink-0">
					<GhostOrb size="50px" variant="outline" />
				</div>
				<PageHeader
					stagger={false}
					subtitle={
						health.coreState === "running"
							? "Core is up. Check any component below, then continue."
							: "Core isn't running yet. It should start automatically, or start it below."
					}
					title={
						health.coreState === "running"
							? "Almost there"
							: "Getting Ryu ready"
					}
				/>
				<div className="flex w-full max-w-md flex-col gap-5">{body}</div>
			</StaggerReveal>
		</div>
	);
}
