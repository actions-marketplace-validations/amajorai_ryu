import { OnboardingView } from "@ryu/blocks/desktop/onboarding";
import { Button } from "@ryu/ui/components/button";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { sileo } from "sileo";
import { WEB_URL } from "@/lib/app-urls.ts";
import {
	ensureCoreInstalled,
	getRyuStatus,
	openExternal,
	startRyuCore,
} from "@/lib/tauri-bridge.ts";
import { ColorStep } from "@/src/components/onboarding/ColorStep.tsx";
import { PreferencesStep } from "@/src/components/onboarding/PreferencesStep.tsx";
import { PrivacyStep } from "@/src/components/onboarding/PrivacyStep.tsx";
import { useCreditsWallet } from "@/src/hooks/useCreditsWallet.ts";
import { AgentCatalogLogo } from "@/src/lib/agent-catalog-logo.tsx";
import { track } from "@/src/lib/analytics.ts";
import {
	type AgentCatalogEntry,
	fetchAgentCatalog,
	installAgent,
} from "@/src/lib/api/agents.ts";
import { type ApiTarget, toTarget } from "@/src/lib/api/client.ts";
// # 0.1.0: Island disabled — uncomment with the onboarding install below
// import { installAndLaunchIsland } from "@/src/lib/api/island.ts";
import { ensureMicPermission } from "@/src/lib/audio/devices.ts";
import { setFeatureEnabled, TOGGLEABLE_FEATURES } from "@/src/lib/features.ts";
import { fetchCatalog, installSidecar } from "@/src/lib/services-api.ts";
import { useAppStore } from "@/src/store/useAppStore.ts";
import {
	isLocalNode,
	LOCAL_FALLBACK,
	type Node,
	useNodeStore,
} from "@/src/store/useNodeStore.ts";

// How long the managed path polls the control plane for an already-provisioned
// node before falling back to the web servers page. Kept short: onboarding must
// never block on a live server coming up.
const ADOPT_MAX_MS = 20 * 1000;
const ADOPT_POLL_MS = 2000;

// Real progress for the auto-advancing (non-interactive) phases, so the bar fills
// as setup actually moves forward. Interactive phases (choose/agents/mic) render
// their own UI, not the bar, so they need no entry.
const PHASE_PROGRESS: Partial<Record<Phase, number>> = {
	starting: 12,
	installing: 60,
	finishing: 90,
	done: 100,
};

// Attach the resolved brand logo to each catalog entry so the shared onboarding
// AgentRow can render it next to the name — the presentational block can't reach
// the desktop's `AgentCatalogLogo` (local engine → SVGL → ACP CDN → Ryu fallback).
const withAgentLogo = (entry: AgentCatalogEntry) => ({
	...entry,
	logo: <AgentCatalogLogo entry={entry} size="20px" />,
});

// The 'agents', 'features', 'mic', 'theme', 'preferences', and 'privacy' phases
// are interactive: the user picks which extra agents to add, optionally enables
// the microphone, sets the look, then tunes a few general + privacy settings.
// Every other phase auto-advances.
type Phase =
	| "starting"
	| "choose"
	| "connect"
	| "installing"
	| "agents"
	| "features"
	| "mic"
	| "theme"
	| "preferences"
	| "privacy"
	| "finishing"
	| "done";

const PHASE_TITLES: Partial<Record<Phase, string>> = {
	choose: "How do you want to run Ryu?",
	connect: "Connect to a node",
	agents: "Add your agents",
	features: "Choose your features",
	mic: "Allow Ryu to access microphone",
	// The theme/preferences/privacy steps render their own headers; these entries
	// only satisfy the map.
	theme: "Make it yours",
	preferences: "Set your preferences",
	privacy: "Your privacy",
	done: "You're all set",
};

const PHASE_SUBTITLES: Partial<Record<Phase, string>> = {
	choose: "Run AI on this device, in the cloud, or on a node you already have",
	connect: "Point this app at a Ryu node that's already running",
	agents: "Pick which ones to add, and install more later",
	features: "Turn features on or off, and change this anytime",
	mic: "So you can talk to your agents. Skip anytime, change later in Settings",
	done: "Ready to go",
};

// The auto-advancing phases (`starting`/`installing`/`finishing`) can sit for a
// long time — `waitForLocalStack` polls the bundled inference install for up to
// 30 minutes. A single frozen line reads as "nothing is happening", so on those
// phases we cycle the header line to make the wait feel alive.
const ROTATING_SUBTITLES: Partial<Record<Phase, string[]>> = {
	starting: [
		"Setting things up",
		"Warming up the engine",
		"Preparing your workspace",
		"Tidying up the place",
		"Unpacking your assistant",
		"Getting comfortable",
	],
	installing: [
		"Installing the AI engine",
		"Downloading your local model",
		"Optimizing for your device",
		"Getting your local AI ready",
		"Teaching Ryu to think",
		"Wiring up the neurons",
		"Loading the brain cells",
		"Tuning the model weights",
		"Almost ready to chat",
		"This part can take a few minutes",
		"Hang tight, nearly there",
		"Putting the finishing touches",
	],
	finishing: [
		"Adding your agents",
		"Applying your preferences",
		"Finishing up",
		"Rolling out the welcome mat",
		"Polishing things off",
		"Just a sec",
	],
};

const ROTATE_INTERVAL_MS = 2600;

const POLL_INTERVAL_MS = 2000;
// Every Core request onboarding makes carries this. `fetch` has no default
// timeout, so one unanswered request is enough to freeze a whole phase — which
// is exactly how the setup screen used to hang with no way out.
const REQUEST_TIMEOUT_MS = 15 * 1000;
// The agent catalog gets a longer one: Core spawns a `--version` probe per agent
// (and an npm lookup per bridge), each bounded at 30s on its side.
const AGENT_CATALOG_TIMEOUT_MS = 60 * 1000;
// How long onboarding will sit on the "installing" screen waiting for the local
// inference stack. A fast (cached) install finishes well inside this and the user
// lands ready. But the install is a sizable model/binary download that can run
// for many minutes — and on macOS it sometimes stays in `installing` for a long
// time — so we never hold the user hostage past this budget: the install keeps
// running in the background and the Models / Getting-Started surfaces track the
// rest. Better to drop them into the app than to freeze the setup screen.
const MAX_BLOCK_MS = 45 * 1000;
// How long the mic step waits on the OS permission dialog before moving on.
const MIC_PROMPT_MAX_MS = 30 * 1000;
const LOCAL_STACK = "llamacpp";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll the control plane for a managed (Ryu Cloud) node the active org can
 * already reach, hydrating the node store on each tick. Resolves the first
 * managed node found, or undefined once the budget elapses or the flow is
 * cancelled. This only adopts a node that already exists; it never provisions.
 */
async function adoptManagedNode(
	hydrate: () => Promise<void>,
	isCancelled: () => boolean
): Promise<Node | undefined> {
	const deadline = Date.now() + ADOPT_MAX_MS;
	while (Date.now() < deadline && !isCancelled()) {
		try {
			await hydrate();
		} catch {
			// Control plane unreachable; keep polling within the budget.
		}
		const managed = useNodeStore.getState().nodes.find((n) => n.managed);
		if (managed) {
			return managed;
		}
		await sleep(ADOPT_POLL_MS);
		if (isCancelled()) {
			return undefined;
		}
	}
	return undefined;
}

/**
 * Poll Core's catalog until the bundled local inference stack finishes (or
 * fails) installing, or the grace budget passes — then let onboarding proceed
 * regardless.
 *
 * On Windows Core auto-triggers the llamacpp install on startup; on macOS that
 * auto-trigger is unreliable, so we kick the install ourselves the first time we
 * see `not_installed` (idempotent: a no-op if Core already started it). Either
 * way we only *block* for `MAX_BLOCK_MS`; the download continues in the
 * background if it's slow, so the user is never stuck on the setup screen.
 */
async function waitForLocalStack(
	node: { url: string; token: string | null },
	isCancelled: () => boolean,
	report: LocalStatusReporter
): Promise<void> {
	const poll = async () => {
		const deadline = Date.now() + MAX_BLOCK_MS;
		let triggered = false;
		while (Date.now() < deadline && !isCancelled()) {
			try {
				const catalog = await fetchCatalog(
					node.url,
					node.token ?? null,
					AbortSignal.timeout(REQUEST_TIMEOUT_MS)
				);
				const entry = catalog.find((c) => c.name === LOCAL_STACK);
				if (entry?.installState === "installed") {
					report.done("Local AI engine ready");
					report.status(null);
					return;
				}
				if (entry?.installState === "failed") {
					report.status(null);
					return;
				}
				if (entry?.installState === "installing") {
					report.status("Installing the local AI engine…", STAGE_ENGINE);
				}
				// Nothing has started the install (macOS path) — start it once, then
				// keep polling. Best-effort: a failed kick just leaves us polling.
				if (!triggered && entry?.installState === "not_installed") {
					triggered = true;
					report.status("Installing the local AI engine…", STAGE_ENGINE);
					await installSidecar(
						node.url,
						node.token ?? null,
						LOCAL_STACK,
						false,
						AbortSignal.timeout(REQUEST_TIMEOUT_MS)
					).catch(() => undefined);
				}
			} catch {
				// Keep polling on transient network errors.
			}
			await sleep(POLL_INTERVAL_MS);
			if (isCancelled()) {
				return;
			}
		}
	};
	// The `Date.now() < deadline` check only runs BETWEEN iterations, so a single
	// request that never settles used to pin this phase forever — the 45s budget
	// was never enforced. Every request inside now carries its own timeout, and
	// this race is the belt-and-braces: the budget is honoured even if one does
	// not. The install keeps running in the background either way.
	await Promise.race([poll(), sleep(MAX_BLOCK_MS)]);
	// Grace budget elapsed and the stack is still installing — proceed anyway and
	// let it finish in the background rather than stranding the user here.
}

// How long the "run locally" pick waits for a Core it just installed/started to
// answer its health check. Generous because the first run may be downloading the
// binary; past this we surface the failure on the choose step rather than
// dropping the user into an app with no backend.
const CORE_BOOT_MAX_MS = 5 * 60 * 1000;
const CORE_BOOT_POLL_MS = 1500;
// After this much of the boot wait, the status admits the wait is long rather
// than repeating "Starting Ryu…" for another four minutes.
const CORE_BOOT_SLOW_MS = 45 * 1000;
// A typed node address gets one short probe — long enough for a LAN round trip,
// short enough that a wrong address fails fast.
const CONNECT_PROBE_TIMEOUT_MS = 6000;

/**
 * Bring a local Core up for the "run locally" pick: install the binary if it is
 * missing (a no-op in dev and when it is already there), start it, then poll
 * health until it answers. Resolves true once Core is running.
 *
 * This is the moment the desktop earns the right to install anything. The app
 * itself opens with no Core at all — a user who connects to their team's node
 * never downloads one — so the install is deferred to the explicit local pick
 * rather than run at boot.
 */
async function startLocalCore(
	isCancelled: () => boolean,
	report: LocalStatusReporter
): Promise<{ error?: string; ok: boolean }> {
	const onStatus = report.status;
	if ((await getRyuStatus().catch(() => "stopped")) === "running") {
		onStatus(null, null);
		return { ok: true };
	}
	onStatus("Getting Ryu ready…", STAGE_PREPARING);
	// A download failure still leaves an older binary usable, so this is not fatal
	// on its own — but it must not be SWALLOWED either. Both halves used to be
	// `.catch(() => undefined)`, so a 404 on the release asset (or a full disk)
	// bought five silent minutes of polling for a binary that was never on disk,
	// and then a generic "couldn't start" card that named nothing.
	const installError = await ensureCoreInstalled().then(
		() => null,
		(err: unknown) => (err instanceof Error ? err.message : String(err))
	);
	if (isCancelled()) {
		return { ok: false };
	}
	const startError = await startRyuCore().then(
		() => null,
		(err: unknown) => (err instanceof Error ? err.message : String(err))
	);
	// Nothing to wait for: the install failed AND the spawn found no binary to
	// run. Report the install error (the useful one) immediately instead of
	// burning the whole boot budget.
	if (installError !== null && startError !== null) {
		return { error: installError, ok: false };
	}

	// The download is over but the pick is not: Core still has to boot and answer
	// its health check, which is up to CORE_BOOT_MAX_MS. The installer stops
	// emitting at `done`, so without a status of our own the card would revert to
	// its marketing copy and sit there for five minutes — the same "nothing is
	// happening" shape, just moved past the download.
	const started = Date.now();
	const deadline = started + CORE_BOOT_MAX_MS;
	onStatus("Starting Ryu…", STAGE_BOOTING);
	while (Date.now() < deadline && !isCancelled()) {
		if ((await getRyuStatus().catch(() => "stopped")) === "running") {
			report.done("Ryu is running");
			onStatus(null, null);
			return { ok: true };
		}
		if (Date.now() - started > CORE_BOOT_SLOW_MS) {
			onStatus(
				"Still starting, the first launch takes a little longer…",
				STAGE_BOOTING
			);
		}
		await sleep(CORE_BOOT_POLL_MS);
	}
	onStatus(null, null);
	// Health never answered. `startError` is null on the common shape of this
	// failure (the spawn succeeded, Core died or hung on boot), so say what we
	// actually observed rather than handing the card an empty detail line.
	return {
		error:
			startError ??
			`Ryu Core was started but never answered its health check within ${Math.round(
				CORE_BOOT_MAX_MS / 60_000
			)} minutes.`,
		ok: false,
	};
}

/** A `<bin>-install-progress` event from the Rust release-hub installer. */
interface InstallProgress {
	error?: string;
	phase: "downloading" | "installing" | "done" | "error";
	received?: number;
	total?: number | null;
}

const MB = 1024 * 1024;
// The two binaries download inside the `installing` phase, so their real fraction
// is mapped into a band that starts where the phase starts and stops short of the
// phase's own placeholder — the bar only ever moves forward as the flow advances
// from download → boot → local-stack wait.
const DOWNLOAD_BAND_START = 12;
const DOWNLOAD_BAND_END = 55;
// The stages either side of the download, which have no measurable fraction of
// their own. They bracket the band so the bar only ever moves forward across the
// whole pick: prepare → download → unpack → boot → the phase's own 60 for the
// local-stack wait that follows.
const STAGE_PREPARING = 8;
const STAGE_BOOTING = 58;
const STAGE_ENGINE = 70;
const STAGE_AGENTS = 82;

/** How the async local bring-up talks to the screen: `status` is what is
 *  happening now (null retires the line), `done` records something finished so it
 *  keeps its turn in the rotation afterwards. */
interface LocalStatusReporter {
	done: (line: string) => void;
	status: (line: string | null, percent?: number | null) => void;
}

/** The download's real completion as a bar percentage, or null when the release
 *  hub sent no `Content-Length` (nothing honest to draw — the phase placeholder
 *  takes over). */
function downloadPercent(p: InstallProgress): number | null {
	if (!p.total) {
		return null;
	}
	const fraction = Math.min(1, (p.received ?? 0) / p.total);
	return Math.round(
		DOWNLOAD_BAND_START + (DOWNLOAD_BAND_END - DOWNLOAD_BAND_START) * fraction
	);
}

/** "Downloading Ryu Core 42%". The percentage is of THIS step's own download,
 *  not of setup as a whole: each binary counts 0–100 for itself, which is what
 *  makes the number mean something while it is on screen. Falls back to a raw
 *  size only when the release hub sends no `Content-Length` (no denominator, so
 *  no honest percentage), and to the bare label before the first chunk lands. */
function downloadLabel(label: string, p: InstallProgress): string {
	const received = p.received ?? 0;
	if (received === 0) {
		return `${label}…`;
	}
	if (!p.total) {
		return `${label} ${Math.round(received / MB)} MB`;
	}
	return `${label} ${stepPercent(received, p.total)}%`;
}

/** This step's own completion, 0–100, clamped so a `Content-Length` that
 *  undercounts can never print 103%. */
function stepPercent(received: number, total: number): number {
	return Math.min(100, Math.round((received / total) * 100));
}

/** Normalize a typed node address: trim, add a scheme if omitted, drop the
 *  trailing slash. `192.168.1.20:7980` and `http://192.168.1.20:7980/` both
 *  resolve to the same URL the node store stores. */
function normalizeNodeUrl(raw: string): string {
	const trimmed = raw.trim().replace(/\/+$/, "");
	if (trimmed === "") {
		return "";
	}
	return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/** Probe a node the user just typed. Unlike `test_node` this takes a URL rather
 *  than the name of an already-persisted node — nothing is written to nodes.json
 *  until this passes. */
async function probeNodeUrl(url: string, token: string): Promise<boolean> {
	const headers: Record<string, string> = {};
	if (token !== "") {
		headers.Authorization = `Bearer ${token}`;
	}
	try {
		const res = await fetch(`${url}/api/health`, {
			headers,
			signal: AbortSignal.timeout(CONNECT_PROBE_TIMEOUT_MS),
		});
		return res.ok;
	} catch {
		return false;
	}
}

/** A stable, human-readable name for a connected node, derived from its host and
 *  de-duplicated against the names already in the store. */
function nodeNameForUrl(url: string, taken: readonly string[]): string {
	let base: string;
	try {
		base = new URL(url).hostname || "node";
	} catch {
		base = "node";
	}
	if (!taken.includes(base)) {
		return base;
	}
	let n = 2;
	while (taken.includes(`${base}-${n}`)) {
		n++;
	}
	return `${base}-${n}`;
}

// The curated set of third-party agents worth surfacing on first run. Anything
// detectable but not on this list is too niche for onboarding and is hidden.
// Ids are matched against the live catalog, so entries that don't exist yet
// (e.g. a future Cursor agent) simply don't render until Core ships them.
const SUGGESTED_AGENT_IDS: readonly string[] = [
	"acp:claude",
	"cursor",
	"acp:cursor",
	"acp:codex",
	"acp:gemini",
	"hermes",
	"openclaw",
];

interface OnboardingAgents {
	/** Agents detected on the user's PATH — shown first, pre-selected. */
	found: AgentCatalogEntry[];
	/** Curated popular agents not already present — opt-in, not pre-selected. */
	suggested: AgentCatalogEntry[];
}

/**
 * Split the agent catalog into the two onboarding buckets: agents already found
 * on the system, and the curated "suggested" set the user can opt into. Ryu and
 * already-added agents are excluded from both. Best-effort: returns empty lists
 * on any error.
 */
async function loadOnboardingAgents(
	target: ApiTarget
): Promise<OnboardingAgents> {
	try {
		// Core probes every agent's CLI and its npm registry entry to build this,
		// so it is the slowest call onboarding makes — and with no timeout it was
		// able to pin the `installing` phase indefinitely. A miss is harmless: the
		// catch below drops through to "no agents to offer" and onboarding moves on.
		const agents = await fetchAgentCatalog(
			target,
			AbortSignal.timeout(AGENT_CATALOG_TIMEOUT_MS)
		);
		const installable = agents.filter((a) => a.id !== "ryu" && !a.added);
		const found = installable.filter((a) => a.detected === true);
		const suggested = SUGGESTED_AGENT_IDS.map((id) =>
			installable.find((a) => a.id === id)
		).filter(
			(a): a is AgentCatalogEntry => a !== undefined && a.detected !== true
		);
		return { found, suggested };
	} catch {
		return { found: [], suggested: [] };
	}
}

export default function OnboardingPage() {
	const navigate = useNavigate();
	const coreStatus = useAppStore((s) => s.coreStatus);
	const { getActiveNode, hydrateCloudNodes, setDefault } = useNodeStore();
	// The exact entitlement read NodeSelector's managed surfaces use (WS8): gates
	// the managed (Ryu Cloud) option on the plan's managed-inference flag.
	const { entitlement, loading: entitlementLoading } = useCreditsWallet();
	const [phase, setPhase] = useState<Phase>("starting");
	// The line currently on screen for an auto-advancing phase. It is set by the
	// rotation tick below, which alternates the flavour copy with whatever is
	// REALLY happening, so the loop is never pure theatre.
	const [loopLine, setLoopLine] = useState<string | null>(null);
	// Managed adoption is polling the control plane for a provisioned node.
	const [managedBusy, setManagedBusy] = useState(false);
	// Webapp-only: the local reachability probe behind the "local" pick. The
	// desktop gates the whole `choose` step on its own Core already running, but
	// the webapp's `get_ryu_status` reports the HOSTED core, so `choose` renders
	// even with nothing on 127.0.0.1 — picking local there used to burn the 45s
	// waitForLocalStack budget and then drop the user into a broken app.
	const [localChecking, setLocalChecking] = useState(false);
	const [localUnreachable, setLocalUnreachable] = useState(false);
	// Why the local pick failed, in Core's own words ("HTTP 404" on a missing
	// release asset, a write error, …). The card used to say only "something went
	// wrong", which is unactionable for the one path that installs software.
	const [localError, setLocalError] = useState<string | null>(null);
	// What the local bring-up is doing RIGHT NOW ("Downloading Ryu Core — 42 of
	// 119 MB"), and the things it has already finished ("Ryu Core installed",
	// "Model gateway installed"). Refs, not state: the byte count updates every
	// megabyte and re-rendering the headline that often would fight TextSwap's
	// crossfade. The rotation tick samples them instead, so the text changes on
	// its own cadence while the progress BAR — which is smooth by nature — tracks
	// `localPercent` live.
	const liveStatusRef = useRef<string | null>(null);
	const doneStatusRef = useRef<string[]>([]);
	const [localPercent, setLocalPercent] = useState<number | null>(null);
	// Which path the user picked on `choose`, or null while they are still on the
	// fork. Only the local path cares whether this device's Core came up, so this
	// is what gates the "Couldn't start Ryu" screen — a user on a remote or cloud
	// node must never be blocked by a Core they deliberately did not install.
	const [mode, setMode] = useState<"local" | "managed" | "remote" | null>(null);
	// The connect-to-an-existing-node form: probe in flight, and why the last
	// attempt failed.
	const [remoteChecking, setRemoteChecking] = useState(false);
	const [remoteError, setRemoteError] = useState<string | null>(null);
	// Guards the async local/managed setup against a late state update after the
	// page unmounts (it unmounts on the final navigate to /chat).
	const cancelledRef = useRef(false);
	useEffect(() => {
		cancelledRef.current = false;
		return () => {
			cancelledRef.current = true;
		};
	}, []);

	// The stages the installer events cannot see — preparing, Core booting, the
	// local engine install, agent detection. A fixed bar position rather than a
	// fraction; null hands the bar back to the phase's own placeholder.
	const reportLocalStatus = useCallback(
		(status: string | null, percent?: number | null) => {
			liveStatusRef.current = status;
			setLocalPercent(percent ?? null);
		},
		[]
	);

	/** Record something that has actually COMPLETED. These keep appearing in the
	 *  loop after the fact, which is the point: the gateway and the local engine
	 *  install silently today, so nothing on screen ever admitted they existed. */
	const reportDone = useCallback((line: string) => {
		const log = doneStatusRef.current;
		if (log.at(-1) !== line) {
			log.push(line);
		}
	}, []);

	/** The pair handed to every async leg of the local bring-up. */
	const localReport = useMemo<LocalStatusReporter>(
		() => ({ done: reportDone, status: reportLocalStatus }),
		[reportDone, reportLocalStatus]
	);

	// Mirror the installers' progress events. BOTH binaries report here — the
	// gateway is 40 MB of the ~160 MB a local pick downloads and nothing ever said
	// so, which is why setup looked like it stalled after "Ryu Core installed".
	useEffect(() => {
		const unlisteners: (() => void)[] = [];
		for (const [event, name] of [
			["core-install-progress", "Ryu Core"],
			["gateway-install-progress", "the model gateway"],
		] as const) {
			listen<InstallProgress>(event, ({ payload }) => {
				if (payload.phase === "downloading") {
					liveStatusRef.current = downloadLabel(`Downloading ${name}`, payload);
					setLocalPercent(downloadPercent(payload));
				} else if (payload.phase === "installing") {
					liveStatusRef.current = `Installing ${name}…`;
					setLocalPercent(DOWNLOAD_BAND_END);
				} else if (payload.phase === "done") {
					// Core's `done` lands while the gateway leg and the boot wait are
					// still ahead, so this only retires the LIVE line — the milestone
					// keeps it in the loop.
					reportDone(`${name} installed`);
					liveStatusRef.current = null;
				} else if (payload.phase === "error") {
					liveStatusRef.current = null;
				}
			}).then((fn) => unlisteners.push(fn));
		}
		return () => {
			for (const fn of unlisteners) {
				fn();
			}
		};
	}, [reportDone]);

	// Agents found on the user's system (pre-selected) and the curated suggested
	// set (opt-in). Only the flagship Ryu agent is installed by default.
	const [foundAgents, setFoundAgents] = useState<AgentCatalogEntry[]>([]);
	const [suggestedAgents, setSuggestedAgents] = useState<AgentCatalogEntry[]>(
		[]
	);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [submitting, setSubmitting] = useState(false);
	// Agents chosen on the picker, held while the later steps are shown.
	const [pendingAgents, setPendingAgents] = useState<string[]>([]);
	// Which feature the one-feature-per-step wizard is currently showing.
	const [featureIndex, setFeatureIndex] = useState(0);

	const finish = useCallback(
		async (target: ApiTarget, installIds: string[]) => {
			setPhase("finishing");

			// Add the agents the user picked. Best-effort: a failed add never blocks
			// onboarding, since the agent can still be added later from the store.
			await Promise.allSettled(
				installIds.map((id) => installAgent(target, id))
			);

			localStorage.setItem("ryu_onboarding_complete", "true");
			track({ event: "onboarding_completed" });
			localStorage.setItem("ryu_default_agent", "ryu");

			await sleep(900);
			setPhase("done");
			await sleep(500);
			navigate("/chat");
		},
		[navigate]
	);

	// Hand off the chosen agents to the features wizard, which walks one optional
	// feature per step before the final (optional) mic step.
	const goToFeatures = useCallback((installIds: string[]) => {
		setPendingAgents(installIds);
		setFeatureIndex(0);
		// TEMP: the "Choose your features" step is disabled — skip straight to the
		// mic step so onboarding never lands on it. Features keep their defaults;
		// they remain toggleable later in Settings → Features.
		setPhase("mic");
	}, []);

	// Advance to the optional microphone step. Voice input is opt-in, so this
	// never blocks finishing — it just gives the OS mic prompt a controlled moment
	// with our own copy instead of firing mid-chat.
	const goToMic = useCallback(() => {
		setPhase("mic");
	}, []);

	// Apply the choice for the feature on screen (a disabled feature hides its
	// sidebar section), then advance to the next feature or on to the mic step.
	// Reads `featureIndex` from the render closure, so it's always the live step.
	const applyFeatureChoice = (enabled: boolean) => {
		const feature = TOGGLEABLE_FEATURES[featureIndex];
		if (feature) {
			setFeatureEnabled(feature.key, enabled);
		}
		const next = featureIndex + 1;
		if (next >= TOGGLEABLE_FEATURES.length) {
			goToMic();
		} else {
			setFeatureIndex(next);
		}
	};

	// The local (bring-your-own-keys) path: wait for the local stack, then detect
	// installable CLI agents and move to the interactive 'agents' step (or
	// straight to the feature wizard when none are installable / the catalog is
	// unreachable). This is the pre-WS8 behaviour, unchanged; it now runs from the
	// user's explicit "local" pick rather than automatically on Core coming up.
	const beginLocalSetup = useCallback(
		async (node: Node) => {
			const target = toTarget(node);

			setPhase("installing");
			// # 0.1.0: Island disabled — uncomment when re-enabling Island onboarding
			// Best-effort: get the Island companion installed + launched during
			// onboarding so it's ready by first chat. Fire-and-forget (no `await`) and
			// non-fatal — it must never block or fail onboarding, and dev is a no-op.
			// installAndLaunchIsland().catch(() => undefined);
			await waitForLocalStack(node, () => cancelledRef.current, localReport);
			if (cancelledRef.current) {
				return;
			}

			localReport.status("Looking for agents on your system…", STAGE_AGENTS);
			const { found, suggested } = await loadOnboardingAgents(target);
			localReport.status(null);
			if (cancelledRef.current) {
				return;
			}

			if (found.length > 0 || suggested.length > 0) {
				setFoundAgents(found);
				setSuggestedAgents(suggested);
				// Pre-select the ones already found on the user's system.
				setSelected(new Set(found.map((a) => a.id)));
				setPhase("agents");
				return;
			}

			goToFeatures([]);
		},
		[goToFeatures, localReport]
	);

	// Present the local / cloud / existing-node fork immediately. This used to
	// wait for `coreStatus === "running"`, which made a local Core a hard
	// prerequisite for even *seeing* the choice — so the one screen offering "you
	// don't need a local Core" was unreachable without one. Nothing on this step
	// talks to Core; each path brings up (or connects to) its own backend from the
	// user's pick. Only advances out of 'starting' so a later phase is never
	// yanked back to the fork.
	useEffect(() => {
		setPhase((p) => (p === "starting" ? "choose" : p));
	}, []);

	// Local pick. Three things it owns:
	//
	// 1. Bring Core up. The app no longer requires (or auto-installs) a local Core
	//    to open, so this pick is where one is installed and started —
	//    `startLocalCore` is a no-op when it is already running, which is the
	//    common case in dev and for a returning user.
	// 2. Resolve the LOCAL node explicitly instead of `getActiveNode()`, whose
	//    default may already be a cloud node — the button labelled "local" was
	//    otherwise able to run local setup against the CLOUD node.
	// 3. Confirm it answers before committing. `waitForLocalStack` swallows every
	//    error and proceeds anyway after 45s, so an unreachable node used to end
	//    with the user inside a fully broken app and onboarding marked complete.
	//    Instead fall BACK to `choose`, where the other two paths are still offered.
	//
	// The pick leaves the fork immediately for the `installing` phase. Everything
	// after the press — the 160 MB download, Core's boot, the local-stack wait — is
	// one continuous wait with one progress bar and one status line, rather than a
	// second progress surface bolted onto the choice card. The card only has to
	// render the FAILURE, which is the one outcome that returns here.
	const handleChooseLocal = useCallback(() => {
		if (localChecking) {
			return;
		}
		setMode("local");
		setLocalChecking(true);
		// Seed the bar before the first await so the phase's flat placeholder never
		// flashes ahead of the real download and then jumps backwards.
		liveStatusRef.current = "Getting Ryu ready…";
		doneStatusRef.current = [];
		setLocalPercent(STAGE_PREPARING);
		setPhase("installing");
		(async () => {
			const nodes = useNodeStore.getState().nodes;
			const node = nodes.find(isLocalNode) ?? LOCAL_FALLBACK;
			// `startLocalCore` resolves only once `/api/health` on the local Core
			// answered, so this IS the reachability proof — no second probe, and no
			// dependency on `nodes.json` existing yet (on a fresh install the file is
			// written a few lines below, by `setDefault`).
			const started = await startLocalCore(
				() => cancelledRef.current,
				localReport
			);
			if (cancelledRef.current) {
				return;
			}
			setLocalChecking(false);
			if (!started.ok) {
				setLocalError(started.error ?? null);
				setLocalUnreachable(true);
				setPhase("choose");
				return;
			}
			setLocalError(null);
			setLocalUnreachable(false);
			// Point the app at the node we just verified, so the rest of onboarding
			// and the app itself talk to it rather than a stale cloud default.
			await setDefault(node.name).catch(() => undefined);
			await beginLocalSetup(node).catch(() => undefined);
		})().catch(() => {
			if (!cancelledRef.current) {
				setLocalChecking(false);
				setLocalUnreachable(true);
				setPhase("choose");
			}
		});
	}, [beginLocalSetup, localChecking, localReport, setDefault]);

	// The only in-product path to a local node: the desktop app hosts it.
	const handleDownloadDesktop = useCallback(() => {
		openExternal(`${WEB_URL}/download`).catch(() => undefined);
	}, []);

	// Open the connect form. Nothing is committed here — the address is probed on
	// submit, and only a node that answers is written to nodes.json.
	const handleChooseRemote = useCallback(() => {
		setRemoteError(null);
		setMode("remote");
		setPhase("connect");
	}, []);

	const handleBackFromConnect = useCallback(() => {
		if (remoteChecking) {
			return;
		}
		setRemoteError(null);
		setMode(null);
		setPhase("choose");
	}, [remoteChecking]);

	// Adopt a node the user already runs (their team's server, another machine on
	// the LAN or mesh). Probe first, persist second: a node that never answered
	// would otherwise sit in the picker forever. Once adopted we run the SAME
	// agent detection the local path does — a company node is a full Core with a
	// real catalog, unlike a managed node, which runs its own inference — but skip
	// `waitForLocalStack`, which polls a local install this device does not have.
	const handleConnectRemote = useCallback(
		(rawUrl: string, token: string) => {
			if (remoteChecking) {
				return;
			}
			const url = normalizeNodeUrl(rawUrl);
			if (url === "") {
				setRemoteError("Enter the node's address.");
				return;
			}
			setRemoteChecking(true);
			setRemoteError(null);
			(async () => {
				const online = await probeNodeUrl(url, token);
				if (cancelledRef.current) {
					return;
				}
				if (!online) {
					setRemoteChecking(false);
					setRemoteError(
						"Couldn't reach a Ryu node there. Check the address, the port, and that the node is running — and the token if it needs one."
					);
					return;
				}

				const state = useNodeStore.getState();
				const existing = state.nodes.find(
					(n) => n.url.replace(/\/+$/, "") === url
				);
				let name = existing?.name;
				if (!name) {
					name = nodeNameForUrl(
						url,
						state.nodes.map((n) => n.name)
					);
					try {
						await state.addNode(name, url, token === "" ? undefined : token);
					} catch (err) {
						if (cancelledRef.current) {
							return;
						}
						setRemoteChecking(false);
						setRemoteError(
							err instanceof Error
								? err.message
								: "Couldn't save this node. Try again."
						);
						return;
					}
				}
				if (cancelledRef.current) {
					return;
				}
				// Route the rest of onboarding — and the app — at the node we just
				// verified. A cloud-shaped node isn't in nodes.json, so fall back to an
				// in-memory default exactly as the managed path does.
				try {
					await setDefault(name);
				} catch {
					useNodeStore.setState({ defaultNode: name });
				}
				setRemoteChecking(false);

				const node = useNodeStore
					.getState()
					.nodes.find((n) => n.name === name) ?? {
					name,
					token: token === "" ? null : token,
					url,
				};
				const { found, suggested } = await loadOnboardingAgents(toTarget(node));
				if (cancelledRef.current) {
					return;
				}
				if (found.length > 0 || suggested.length > 0) {
					setFoundAgents(found);
					setSuggestedAgents(suggested);
					setSelected(new Set(found.map((a) => a.id)));
					setPhase("agents");
					return;
				}
				goToFeatures([]);
			})().catch(() => {
				if (!cancelledRef.current) {
					setRemoteChecking(false);
					setRemoteError("Couldn't connect to that node. Try again.");
				}
			});
		},
		[goToFeatures, remoteChecking, setDefault]
	);

	// Managed (Ryu Cloud) pick. Gated on the plan entitlement: if not entitled
	// (or the plan is still resolving to not-entitled) this is an upsell that
	// deep-links to web pricing and stays on the choice screen. When entitled it
	// adopts an already-provisioned org node (never provisions from the desktop):
	// poll the control plane briefly, then set it as the active node; if none
	// exists yet, deep-link to the org servers page and continue on local so the
	// user is never stranded waiting on a server to come up.
	const handleChooseManaged = useCallback(async () => {
		if (!entitlement?.managedInference) {
			openExternal(`${WEB_URL}/pricing`).catch(() => undefined);
			return;
		}
		if (managedBusy) {
			return;
		}
		setMode("managed");
		setManagedBusy(true);
		const adopted = await adoptManagedNode(
			hydrateCloudNodes,
			() => cancelledRef.current
		);
		if (cancelledRef.current) {
			return;
		}
		setManagedBusy(false);

		if (adopted) {
			// Managed/cloud nodes live in memory only (never in nodes.json), so the
			// Rust set_default_node rejects their name. Try the persisted path for
			// parity, then fall back to an in-memory default so chat routes to the
			// adopted node this session.
			try {
				await setDefault(adopted.name);
			} catch {
				useNodeStore.setState({ defaultNode: adopted.name });
			}
			// A managed node runs its own inference; skip local CLI-agent detection
			// and go straight to the feature wizard.
			goToFeatures([]);
			return;
		}

		// Entitled, but no node is provisioned yet. Provisioning is web + webhook
		// driven (never from the desktop), so point them at the org servers page
		// and continue on local so onboarding still completes.
		sileo.success({
			title: "Provisioning continues on the web",
			description:
				"Buy or start a Ryu Cloud server in your browser. It appears here once it registers.",
		});
		openExternal(`${WEB_URL}/organizations`).catch(() => undefined);
		// Fall back to the local path so onboarding still completes — which now
		// means actually bringing a local Core up, since the app no longer starts
		// one at boot. Same explicit local-node resolution as the local pick;
		// `getActiveNode()` here could be the cloud node we just failed to adopt.
		setMode("local");
		// Same `localChecking` bookkeeping the direct local pick does. Without it
		// this path showed no download progress at all, and — because `coreFailed`
		// is `coreStatus === "stopped" && mode === "local" && !localChecking` —
		// flipping `mode` to "local" after App.tsx's startup grace had elapsed
		// replaced the running 160 MB download with the "Couldn't start Ryu"
		// restart screen.
		setLocalChecking(true);
		liveStatusRef.current = "Getting Ryu ready…";
		setLocalPercent(STAGE_PREPARING);
		setPhase("installing");
		startLocalCore(() => cancelledRef.current, localReport)
			.then((started) => {
				setLocalChecking(false);
				if (!started.ok || cancelledRef.current) {
					setLocalError(started.error ?? null);
					setLocalUnreachable(true);
					setPhase("choose");
					return undefined;
				}
				return beginLocalSetup(
					useNodeStore.getState().nodes.find(isLocalNode) ?? LOCAL_FALLBACK
				);
			})
			.catch(() => undefined);
	}, [
		entitlement,
		managedBusy,
		hydrateCloudNodes,
		setDefault,
		goToFeatures,
		beginLocalSetup,
		localReport,
	]);

	// Cycle the header line while a long auto-advancing phase is on screen, so the
	// view never looks frozen — but alternate the flavour copy with the REAL state
	// of the work: what is downloading right now, or the last thing that finished.
	// A pure flavour loop is indistinguishable from a hang, and it was hiding two
	// entire install legs (gateway, local engine) behind "Teaching Ryu to think".
	useEffect(() => {
		const flavour = ROTATING_SUBTITLES[phase];
		if (!flavour) {
			setLoopLine(null);
			return;
		}
		let tick = 0;
		let flavourIndex = 0;
		const advance = () => {
			const real =
				liveStatusRef.current ?? doneStatusRef.current.at(-1) ?? null;
			// Every other tick is the real line, when there is one. The flavour index
			// advances only on flavour turns, so nothing is skipped — and on a phase
			// with no real state to report (the cloud paths) every tick is flavour and
			// the loop behaves exactly as it did before.
			if (tick % 2 === 1 && real) {
				setLoopLine(real);
			} else {
				setLoopLine(flavour[flavourIndex % flavour.length] ?? null);
				flavourIndex += 1;
			}
			tick += 1;
		};
		advance();
		const id = setInterval(advance, ROTATE_INTERVAL_MS);
		return () => clearInterval(id);
	}, [phase]);

	// When Ryu never comes up (App.tsx flips it to "stopped" after its startup
	// timeout) a local-path user would otherwise sit on a shimmering progress bar
	// with no way out, so we render a dedicated error state with a restart button.
	// Scoped to the LOCAL path: a user who picked the cloud or their own node has
	// no local Core by design, and "stopped" is the correct, expected state for
	// them — blocking them on it is what made the desktop unusable without an
	// install in the first place.
	// Not while the local pick is still working: `startLocalCore` may be several
	// minutes into downloading the binary, which is longer than App.tsx's startup
	// grace — reporting that as "Couldn't start Ryu" would replace a working
	// install with an error screen. A genuine failure there ends on `choose` with
	// the unreachable card instead.
	const coreFailed =
		coreStatus === "stopped" && mode === "local" && !localChecking;
	// On the auto-advancing phases the rotating copy IS the headline; everywhere
	// else the static title/subtitle pair carries the step. Every non-rotating
	// phase has a PHASE_TITLES entry, so the fallthrough is always defined.
	const subtitle = loopLine ? undefined : PHASE_SUBTITLES[phase];
	const title = loopLine ?? PHASE_TITLES[phase]!;

	// Restart the whole app so it re-attempts startup from scratch; fall back to a
	// plain reload if the Tauri process plugin isn't reachable.
	const handleRestart = useCallback(async () => {
		try {
			const { relaunch } = await import("@tauri-apps/plugin-process");
			await relaunch();
		} catch {
			window.location.reload();
		}
	}, []);

	const toggle = useCallback((id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	}, []);

	const handleContinue = useCallback(() => {
		goToFeatures(Array.from(selected));
	}, [goToFeatures, selected]);

	// The mic answer (either way) hands off to the look-and-feel step, so the user
	// lands in an app that already looks like theirs. Clearing `submitting` matters:
	// the mic step sets it while the OS prompt is up, and leaving it pinned would
	// render the theme step's Continue disabled.
	const goToTheme = useCallback(() => {
		setSubmitting(false);
		setPhase("theme");
	}, []);

	// Leave the mic step. Skip goes straight on; Allow requests mic access first
	// (non-blocking: a denial still completes onboarding).
	const handleSkipMic = useCallback(() => {
		if (submitting) {
			return;
		}
		goToTheme();
	}, [submitting, goToTheme]);

	const handleAllowMic = useCallback(async () => {
		if (submitting) {
			return;
		}
		setSubmitting(true);
		try {
			// `getUserMedia` only settles when the OS prompt is answered, so an
			// ignored (or focus-lost) TCC dialog leaves it pending forever. With both
			// mic buttons disabled while `submitting`, that used to be a dead end;
			// race it so onboarding always moves on. The grant still lands if the
			// user answers later — we just stop waiting for them.
			await Promise.race([ensureMicPermission(), sleep(MIC_PROMPT_MAX_MS)]);
		} catch {
			// Permission prompt denied or unavailable — still continue onboarding.
		}
		if (cancelledRef.current) {
			return;
		}
		goToTheme();
	}, [submitting, goToTheme]);

	// The theme step already persisted every pick as it was made, so Continue
	// just hands off to the general-settings step.
	const goToPreferences = useCallback(() => {
		if (submitting) {
			return;
		}
		setSubmitting(false);
		setPhase("preferences");
	}, [submitting]);

	// The preferences step persists each toggle as it's flipped, so Continue just
	// hands off to the privacy step.
	const goToPrivacy = useCallback(() => {
		if (submitting) {
			return;
		}
		setSubmitting(false);
		setPhase("privacy");
	}, [submitting]);

	// The privacy step already persisted every consent as it was made, so
	// finishing is just the agent installs plus the hand-off to chat.
	const handleFinishPrivacy = useCallback(() => {
		if (submitting) {
			return;
		}
		setSubmitting(true);
		finish(toTarget(getActiveNode()), pendingAgents);
	}, [submitting, getActiveNode, finish, pendingAgents]);

	if (coreFailed) {
		return (
			<div
				className="flex size-full flex-col items-center justify-center gap-6 p-8"
				data-tauri-drag-region="true"
			>
				<div className="max-w-md space-y-2 text-center">
					<p className="font-medium text-foreground text-xl">
						Couldn't start Ryu
					</p>
					<p className="text-muted-foreground text-sm">
						Something stopped Ryu from starting up. Restarting the app usually
						fixes it.
					</p>
				</div>
				<Button onClick={handleRestart} size="sm">
					Restart Ryu
				</Button>
			</div>
		);
	}

	// The theme/preferences/privacy steps are desktop-only (they drive the
	// desktop's own theme setters, appearance toggles, autostart registration,
	// and Core privacy prefs), so they render here rather than through the shared
	// block, whose `OnboardingStep` union has no member for them.
	if (phase === "theme") {
		return (
			<div className="size-full" data-tauri-drag-region="true">
				<ColorStep busy={submitting} onContinue={goToPreferences} />
			</div>
		);
	}

	if (phase === "preferences") {
		return (
			<div className="size-full" data-tauri-drag-region="true">
				<PreferencesStep busy={submitting} onContinue={goToPrivacy} />
			</div>
		);
	}

	if (phase === "privacy") {
		return (
			<div className="size-full" data-tauri-drag-region="true">
				<PrivacyStep busy={submitting} onContinue={handleFinishPrivacy} />
			</div>
		);
	}

	return (
		<div className="size-full" data-tauri-drag-region="true">
			<OnboardingView
				agents={foundAgents.map(withAgentLogo)}
				currentFeature={TOGGLEABLE_FEATURES[featureIndex]}
				featureStepIndex={featureIndex + 1}
				featureStepTotal={TOGGLEABLE_FEATURES.length}
				isDesktop
				localChecking={localChecking}
				localError={localError}
				localUnreachable={localUnreachable}
				managedBusy={managedBusy}
				managedEntitled={Boolean(entitlement?.managedInference)}
				managedLoading={entitlementLoading}
				micSubmitting={submitting}
				onBackFromConnect={handleBackFromConnect}
				onChooseLocal={handleChooseLocal}
				onChooseManaged={handleChooseManaged}
				onChooseRemote={handleChooseRemote}
				onConnectRemote={handleConnectRemote}
				onContinueAgents={handleContinue}
				onContinueMic={handleAllowMic}
				onDownloadDesktop={handleDownloadDesktop}
				onEnableFeature={() => applyFeatureChoice(true)}
				onSkipAgents={() => goToFeatures([])}
				onSkipFeature={() => applyFeatureChoice(false)}
				onSkipMic={handleSkipMic}
				onToggleAgent={toggle}
				progress={localPercent ?? PHASE_PROGRESS[phase]}
				remoteChecking={remoteChecking}
				remoteError={remoteError}
				selected={selected}
				step={phase}
				subtitle={subtitle}
				suggestedAgents={suggestedAgents.map(withAgentLogo)}
				title={title}
			/>
		</div>
	);
}
