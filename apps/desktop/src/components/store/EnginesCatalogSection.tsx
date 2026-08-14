// apps/desktop/src/components/store/EnginesCatalogSection.tsx
//
// The unified Engines section in the Store. One tab, grouped by modality:
// Text and Embedding · Image · Speech · Sandboxes. Each group lists that
// modality's local engines (the catalog's `provider` / `media` / `voice`
// categories) — NOT models.
//
// Uses the shared Store master-detail layout (left list, right preview) like
// Plugins, Models, MCP, and Skills.
//
// Two interaction models:
//   - Text (chat) engines are mutually exclusive — exactly one is the resident
//     engine, so the toggle SWAPS the active engine (re-points the gateway).
//   - Image / Speech engines run *alongside* the chat engine, so their toggle is
//     a plain start/stop of the engine's sidecar process.

import { CpuIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	EngineFootnote,
	EngineInstallButton,
	type EngineInstallState,
	EnginesErrorState,
} from "@ryu/blocks/desktop/store-engines";
import StoreCatalogCard from "@ryu/marketplace/catalog/chrome/store-catalog-card";
import StoreCatalogLayout, {
	StoreCardGrid,
} from "@ryu/marketplace/catalog/chrome/store-catalog-layout";
import StoreItemAction, {
	StoreItemOverflowMenu,
	storeItemContextMenu,
} from "@ryu/marketplace/catalog/chrome/store-item-action";
import StoreShelfHeading from "@ryu/marketplace/catalog/chrome/store-shelf-heading";
import {
	ListingAsideCard,
	ListingDetailShell,
	ListingHero,
	ListingInfoGrid,
	ListingSection,
	ListingStatStrip,
} from "@ryu/marketplace/catalog/detail/listing-detail-shell";
import { Badge } from "@ryu/ui/components/badge";
import { Button } from "@ryu/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ryu/ui/components/empty";
import { Label } from "@ryu/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@ryu/ui/components/radio-group";
import { Spinner } from "@ryu/ui/components/spinner";
import { StatusBadge, type StatusKind } from "@ryu/ui/components/status-badge";
import { Switch } from "@ryu/ui/components/switch";
import { type ComponentProps, useMemo, useState } from "react";
import { useDebouncedValue } from "@/src/hooks/use-debounced-value.ts";
import { useEngines } from "@/src/hooks/useEngines.ts";
import { useLlamacppAcceleration } from "@/src/hooks/useLlamacppAcceleration.ts";
import {
	type PluginSettingsOpener,
	usePluginSettingsOpener,
} from "@/src/hooks/usePluginSettingsOpener.ts";
import {
	type SandboxBackendEntry,
	useSandboxBackends,
} from "@/src/hooks/useSandboxBackends.ts";
import {
	useVoiceEngines,
	type VoiceEngineEntry,
} from "@/src/hooks/useVoiceEngines.ts";
import { useInstallProgress } from "@/src/store/useDownloadsStore.ts";

const SEARCH_DEBOUNCE_MS = 200;

/** Run-alongside (start/stop) categories, in display order under their headers. */
const RUN_ALONGSIDE_CATEGORIES = ["media", "voice"] as const;

const GROUP_LABELS: Record<string, string> = {
	text: "Text and Embedding",
	media: "Image",
	voice: "Speech",
	sandbox: "Sandboxes",
};

/** Human label for an OS family id (as Core reports it in `platforms`). */
const PLATFORM_LABELS: Record<string, string> = {
	macos: "macOS (Apple Silicon)",
	windows: "Windows",
	linux: "Linux",
};

type EngineListKind = "text" | "media" | "voice" | "sandbox";

interface EngineListItem {
	/** False when this node's OS can't run the engine — no Install is offered. */
	available: boolean;
	/** Uninstall is withheld while the engine is the resident/running one. */
	canUninstall: boolean;
	description: string;
	displayName: string;
	/** The node says a newer build is actually reachable (drives forced install). */
	hasUpdate: boolean;
	id: string;
	/** Installed (text/image/speech) or detected on the node (sandbox backends). */
	installed: boolean;
	/** Null for rows with no install lifecycle of their own (sandbox backends,
	 *  which are detected on the node rather than installed by Ryu). */
	installState: EngineInstallState | null;
	kind: EngineListKind;
	name: string;
	/** The row's live STATE, as the shared status glyph plus the word it shows on
	 *  hover. It used to be a bare `string | null` rendered as a grey text badge;
	 *  three words ("Active", "Running", "Default") repeated down a two-column
	 *  grid is most of what made the section look noisy, and none of them said
	 *  anything the glyph cannot.
	 *
	 *  `label` overrides the kind's default word, which is what lets an image or
	 *  speech engine say "Running" while wearing the same green check a text
	 *  engine's "Active" does — they are the same state under two vocabularies. */
	status: { kind: StatusKind; label?: string } | null;
	/** Current toggle position: active (text) / running (image, speech) /
	 *  default (sandbox). */
	toggled: boolean;
}

type PendingKind = "install" | "uninstall" | "toggle";

interface RowState {
	error: string | null;
	gatewayStale: boolean;
	pending: PendingKind | null;
}

const EMPTY_ROW_STATE: RowState = {
	pending: null,
	error: null,
	gatewayStale: false,
};

function LiveEngineInstallButton({
	engineName,
	...props
}: { engineName: string } & Omit<
	ComponentProps<typeof EngineInstallButton>,
	"percent"
>) {
	const { percent } = useInstallProgress(
		["engine", "voice", "media", "embedding"],
		engineName
	);
	return <EngineInstallButton percent={percent} {...props} />;
}

function unsupportedReason(platforms: string[]): string {
	if (platforms.length === 0) {
		return "Not available on this node";
	}
	const labels = platforms.map((p) => PLATFORM_LABELS[p] ?? p).join(" / ");
	return `Requires ${labels} — the connected node can't run it`;
}

/**
 * Whether to offer an update for this engine — the NODE's verdict, not a version
 * comparison made here.
 *
 * Comparing `installedVersion` to `latestVersion` client-side is what made this
 * button a lie: engines whose downloader pins its tag at compile time can never
 * reach the upstream version the catalog used to advertise, so the row showed an
 * update forever and pressing it hit an already-installed fast path in Core that
 * did nothing at all.
 */
function hasEngineUpdate(engine: { updateAvailable: boolean }): boolean {
	return engine.updateAvailable;
}

/** Where to get each sandbox runtime, for the row that cannot install it.
 *
 *  Ryu deliberately never installs Docker: `crates/core/sandbox/src/docker.rs`
 *  carries a LOCKED DECISION (issue #191) to stay detection-only, enforced by a
 *  committed `detect_does_not_install_docker` test. That is not squeamishness —
 *  on macOS the cask still ends in a EULA modal and a privileged-helper prompt,
 *  on Linux the package needs root and `docker` group membership is
 *  root-equivalent, and on Windows it needs admin plus WSL2 plus a reboot. An
 *  "install" that ends with the user typing an admin password is a slower version
 *  of telling them to install it.
 *
 *  What was NOT defensible is what the row said about it. A non-interactive
 *  "Not detected" chip and a sentence reading "install its CLI on the node" named
 *  nothing, linked nowhere, and offered no action — so the honest answer ("Ryu
 *  will not install this one, here is where to get it") was indistinguishable
 *  from a broken feature. */
const SANDBOX_INSTALL_DOCS: Record<string, { href: string; what: string }> = {
	docker: {
		href: "https://docs.docker.com/get-started/get-docker/",
		what: "Docker Desktop or Colima",
	},
	microsandbox: {
		href: "https://github.com/microsandbox/microsandbox",
		what: "the microsandbox CLI",
	},
	opensandbox: {
		href: "https://github.com/agentsea/opensandbox",
		what: "the opensandbox CLI",
	},
};

function sandboxDescription(backend: SandboxBackendEntry): string {
	if (!backend.supported) {
		return unsupportedReason(
			backend.name === "microsandbox" || backend.name === "opensandbox"
				? ["linux", "macos"]
				: []
		);
	}
	if (backend.detected) {
		return "Detected on this node and ready to use.";
	}
	if (backend.name === "wasmtime") {
		return "Built-in WASM sandbox (compile with the sandbox-wasmtime feature).";
	}
	const docs = SANDBOX_INSTALL_DOCS[backend.name];
	return docs
		? `Not detected. Ryu does not install this one — it needs elevated privileges on every platform — so install ${docs.what} yourself and it is picked up automatically.`
		: "Not detected — install its CLI on the node to use it.";
}

function useRowStates() {
	const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
	const rowState = (name: string): RowState =>
		rowStates[name] ?? EMPTY_ROW_STATE;
	const patchRow = (name: string, patch: Partial<RowState>) => {
		setRowStates((prev) => ({
			...prev,
			[name]: { ...(prev[name] ?? EMPTY_ROW_STATE), ...patch },
		}));
	};
	const runAction = async (
		name: string,
		kind: PendingKind,
		action: () => Promise<void>
	) => {
		patchRow(name, { pending: kind, error: null, gatewayStale: false });
		try {
			await action();
		} catch (e) {
			patchRow(name, {
				error: e instanceof Error ? e.message : `Failed to ${kind} ${name}`,
			});
		} finally {
			patchRow(name, { pending: null });
		}
	};
	return { rowState, patchRow, runAction };
}

/** Per-kind wording for the engine toggle, so the menu says what the toggle
 *  actually does: a text engine is SWAPPED to (it can never be switched off — the
 *  node always has a resident engine), image/speech engines start and stop, and a
 *  sandbox backend is picked as the default. */
const TOGGLE_LABELS: Record<
	EngineListKind,
	{ disable?: string; enable: string }
> = {
	text: { enable: "Set as active" },
	media: { enable: "Start", disable: "Stop" },
	voice: { enable: "Start", disable: "Stop" },
	sandbox: { enable: "Set as default" },
};

/**
 * The inline lifecycle control on an engine card — the SAME {@link StoreItemAction}
 * Apps, Plugins, Skills, MCP and Agents cards use, so an engine installs from the
 * list without first opening its preview.
 *
 * Its own component (not a node built in the list's `useMemo`) because the live
 * download percent comes from a hook, which can't run per-item inside a memo.
 *
 * Rows with nothing to offer render a status Badge instead of an empty 3-dot menu:
 * an engine this node can't run, and one whose only action would be a toggle it is
 * already in (the resident text engine, the default sandbox — neither can be
 * switched off, only swapped away from by picking another row).
 */
/**
 * The right-click rows for an engine card — the same branches
 * {@link EngineCardAction} takes, restated for the context-menu primitive.
 *
 * `undefined` (no menu at all) for the two rows that genuinely have no verb: an
 * engine this platform cannot run, and a sandbox runtime Ryu only DETECTS. Both
 * already say so in their status badge, and a menu whose single row is greyed
 * out teaches nothing the badge did not.
 */
function engineCardContextMenu({
	item,
	onInstall,
	onOpenSettings,
	onToggle,
	onUninstall,
}: {
	item: EngineListItem;
	onInstall: (item: EngineListItem) => void;
	onOpenSettings?: (() => void) | null;
	onToggle: (item: EngineListItem, next: boolean) => void;
	onUninstall: (item: EngineListItem) => void;
}) {
	if (!item.available) {
		return undefined;
	}
	const labels = TOGGLE_LABELS[item.kind];
	if (!item.installed) {
		if (item.installState === null) {
			return undefined;
		}
		return storeItemContextMenu({
			installed: false,
			onInstall: () => onInstall(item),
			onOpenSettings: onOpenSettings ?? undefined,
		});
	}
	const canToggleOn = !item.toggled;
	const canToggleOff = item.toggled && Boolean(labels.disable);
	return storeItemContextMenu({
		disableLabel: labels.disable,
		enabled: item.toggled,
		enableLabel: labels.enable,
		installed: true,
		onDisable: canToggleOff ? () => onToggle(item, false) : undefined,
		onEnable: canToggleOn ? () => onToggle(item, true) : undefined,
		onOpenSettings: onOpenSettings ?? undefined,
		onUninstall: item.canUninstall ? () => onUninstall(item) : undefined,
	});
}

function EngineCardAction({
	item,
	busy,
	onInstall,
	onUninstall,
	onToggle,
	onOpenSettings,
}: {
	busy: boolean;
	item: EngineListItem;
	onInstall: (item: EngineListItem) => void;
	onToggle: (item: EngineListItem, next: boolean) => void;
	onUninstall: (item: EngineListItem) => void;
	/** Set for an engine that is ALSO an installed plugin with settings (a voice
	 *  or sandbox backend shipped as an app); null for the rest. */
	onOpenSettings?: (() => void) | null;
}) {
	const { percent } = useInstallProgress(
		["engine", "voice", "media", "embedding"],
		item.name
	);
	const labels = TOGGLE_LABELS[item.kind];

	if (!item.available) {
		return (
			// The row shape carries `available` but not the platform list the reason
			// text is built from (only the text-engine detail has it), so the card
			// says the generic thing and the detail hero says which platforms.
			<StatusBadge kind="unavailable" label="Not supported on this platform" />
		);
	}

	if (!item.installed) {
		// A sandbox backend has no install lifecycle in Ryu — its CLI is detected on
		// the node or it isn't — so it gets a status, not an Install button that
		// could not do anything.
		if (item.installState === null) {
			// Not a bare chip: this row can never gain an Install button (Ryu is
			// detection-only for sandbox runtimes), so a dead badge is the ONLY thing
			// the user would ever see here. The glyph carries the reason on hover and
			// the link is the action the row is actually able to offer.
			const docs = SANDBOX_INSTALL_DOCS[item.name];
			return (
				<div className="flex items-center gap-1">
					<StatusBadge
						kind="unavailable"
						label={
							docs
								? `Not detected. Ryu does not install ${item.displayName} — it needs elevated privileges on every platform. Install ${docs.what} and it is picked up automatically.`
								: "Not detected on this node"
						}
					/>
					{docs ? (
						<Button
							render={
								<a href={docs.href} rel="noopener noreferrer" target="_blank" />
							}
							size="sm"
							variant="ghost"
						>
							How to install
						</Button>
					) : null}
				</div>
			);
		}
		return (
			<StoreItemAction
				busy={busy || item.installState === "installing"}
				installed={false}
				onInstall={() => onInstall(item)}
				onOpenSettings={onOpenSettings ?? undefined}
				percent={percent}
			/>
		);
	}

	const canToggleOn = !item.toggled;
	const canToggleOff = item.toggled && Boolean(labels.disable);
	// Nothing left to offer (the resident text engine and the default sandbox can
	// only be swapped away from, by picking another row) → render nothing rather
	// than a 3-dot menu that opens empty. The row's status badge, which such a row
	// always carries ("Active" / "Default"), already says where it stands.
	if (!(canToggleOn || canToggleOff || item.canUninstall)) {
		// …unless it is configurable, in which case the menu is not empty after all.
		return onOpenSettings ? (
			<StoreItemOverflowMenu onOpenSettings={onOpenSettings} />
		) : null;
	}

	return (
		<StoreItemAction
			busy={busy}
			disableLabel={labels.disable}
			enabled={item.toggled}
			enableLabel={labels.enable}
			installed
			onDisable={canToggleOff ? () => onToggle(item, false) : undefined}
			onEnable={canToggleOn ? () => onToggle(item, true) : undefined}
			onOpenSettings={onOpenSettings ?? undefined}
			onUninstall={item.canUninstall ? () => onUninstall(item) : undefined}
			percent={percent}
		/>
	);
}

function EngineList({
	groups,
	loading,
	error,
	selectedId,
	onSelect,
	rowState,
	onInstall,
	onUninstall,
	onToggle,
	settingsOpener,
}: {
	/** Resolves a row to its settings tab; null for an engine that is not an
	 *  installed plugin, which is most of them. */
	settingsOpener: PluginSettingsOpener;
	groups: { kind: EngineListKind; items: EngineListItem[] }[];
	loading: boolean;
	error: string | null;
	selectedId: string | null;
	onInstall: (item: EngineListItem) => void;
	onSelect: (id: string) => void;
	onToggle: (item: EngineListItem, next: boolean) => void;
	onUninstall: (item: EngineListItem) => void;
	rowState: (name: string) => RowState;
}) {
	const total = groups.reduce((n, g) => n + g.items.length, 0);

	if (loading && total === 0) {
		return (
			<div className="flex items-center justify-center p-8 text-muted-foreground">
				<Spinner className="size-5" />
			</div>
		);
	}
	if (error && total === 0) {
		return (
			<div className="p-4 text-destructive text-sm">
				Couldn't load engines: {error}
			</div>
		);
	}
	if (total === 0) {
		return (
			<Empty className="h-full p-6">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<HugeiconsIcon icon={CpuIcon} />
					</EmptyMedia>
					<EmptyTitle>No engines found</EmptyTitle>
					<EmptyDescription>Try a different search.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<div className="flex flex-col gap-6 pt-2">
			{groups.map((group) => (
				<section key={group.kind}>
					<StoreShelfHeading>{GROUP_LABELS[group.kind]}</StoreShelfHeading>
					<StoreCardGrid>
						{group.items.map((item) => (
							<StoreCatalogCard
								action={
									<div className="flex items-center gap-2">
										{item.status ? (
											<StatusBadge
												kind={item.status.kind}
												label={item.status.label}
											/>
										) : null}
										<EngineCardAction
											busy={rowState(item.name).pending !== null}
											item={item}
											onInstall={onInstall}
											onOpenSettings={settingsOpener(item.id)}
											onToggle={onToggle}
											onUninstall={onUninstall}
										/>
									</div>
								}
								contextMenu={engineCardContextMenu({
									item,
									onInstall,
									onOpenSettings: settingsOpener(item.id),
									onToggle,
									onUninstall,
								})}
								description={item.description}
								// An engine that cannot run on this platform is dimmed, never
								// hidden — the platform answer is exactly what the user came to
								// find. Its status glyph carries the reason.
								dimmed={!item.available}
								icon={<HugeiconsIcon className="size-5" icon={CpuIcon} />}
								key={item.id}
								name={item.displayName}
								onClick={() => onSelect(item.id)}
								seedId={item.id}
								selected={item.id === selectedId}
							/>
						))}
					</StoreCardGrid>
				</section>
			))}
		</div>
	);
}

/** The engine whose build can be swapped between CPU and GPU. */
const ACCELERATION_ENGINE = "llamacpp";

/**
 * CPU-vs-GPU build picker for llama.cpp.
 *
 * Written for someone who does not know what CUDA, Metal or Vulkan are: the
 * first line states what is happening right now in plain words, "Automatic" is
 * the default and is marked recommended, and the builds this computer cannot
 * run are visibly disabled with the reason next to them rather than hidden
 * (hiding them makes the list look arbitrary; showing why is what teaches).
 */
function EngineAccelerationSection() {
	const { acceleration, loading, switching, error, select } =
		useLlamacppAcceleration();

	if (loading && !acceleration) {
		return (
			<ListingSection title="Speed">
				<Spinner className="size-4" />
			</ListingSection>
		);
	}
	if (!acceleration) {
		return null;
	}

	const { selected, resolvedLabel, hasGpu, gpuName, vram, options } =
		acceleration;
	const hardware = hasGpu
		? `Graphics card detected${gpuName ? `: ${gpuName}` : ""}${vram ? ` (${vram})` : ""}.`
		: "No usable graphics card detected on this computer.";

	return (
		<ListingSection title="Speed">
			<p className="text-muted-foreground text-sm leading-relaxed">
				{hardware} Right now this engine runs on{" "}
				<span className="text-foreground">{resolvedLabel}</span>. Leave this on
				Automatic unless something is going wrong — Ryu picks the fastest option
				your computer can actually run.
			</p>
			<RadioGroup
				aria-label="How llama.cpp runs"
				className="mt-3"
				disabled={switching}
				onValueChange={(value) => {
					void select(String(value));
				}}
				value={selected}
			>
				<div className="flex items-start gap-2.5">
					<RadioGroupItem
						className="mt-0.5"
						id="llamacpp-accel-auto"
						value="auto"
					/>
					<div className="flex flex-col gap-0.5">
						<Label
							className="flex items-center gap-2 font-medium text-sm"
							htmlFor="llamacpp-accel-auto"
						>
							Automatic
							<Badge variant="secondary">Recommended</Badge>
						</Label>
						<p className="text-muted-foreground text-xs">
							Detects your hardware and uses the fastest option available.
						</p>
					</div>
				</div>
				{options.map((option) => {
					const id = `llamacpp-accel-${option.id}`;
					return (
						<div
							className={
								option.available
									? "flex items-start gap-2.5"
									: "flex items-start gap-2.5 opacity-60"
							}
							key={option.id}
						>
							<RadioGroupItem
								className="mt-0.5"
								disabled={!option.available}
								id={id}
								value={option.id}
							/>
							<div className="flex flex-col gap-0.5">
								<Label className="font-medium text-sm" htmlFor={id}>
									{option.label}
								</Label>
								<p className="text-muted-foreground text-xs">
									{option.available
										? option.description
										: option.unavailableReason}
								</p>
							</div>
						</div>
					);
				})}
			</RadioGroup>
			{switching && (
				<p className="mt-2 flex items-center gap-2 text-muted-foreground text-sm">
					<Spinner className="size-4" />
					Downloading and switching the build…
				</p>
			)}
			{error && <EngineFootnote tone="destructive">{error}</EngineFootnote>}
		</ListingSection>
	);
}

function EngineDetailPanel({
	selectedId,
	textEngines,
	voiceEngines,
	sandboxBackends,
	textLoading,
	voiceLoading,
	sandboxLoading,
	textError,
	voiceError,
	sandboxError,
	installText,
	uninstallText,
	activateText,
	installVoice,
	uninstallVoice,
	setVoiceRunning,
	selectSandbox,
	rowState,
	patchRow,
	runAction,
}: {
	selectedId: string | null;
	textEngines: ReturnType<typeof useEngines>["engines"];
	voiceEngines: VoiceEngineEntry[];
	sandboxBackends: SandboxBackendEntry[];
	textLoading: boolean;
	voiceLoading: boolean;
	sandboxLoading: boolean;
	textError: string | null;
	voiceError: string | null;
	sandboxError: string | null;
	installText: (name: string, force?: boolean) => Promise<void>;
	uninstallText: (name: string) => Promise<void>;
	activateText: (name: string) => Promise<{ gatewayRefreshed: boolean }>;
	installVoice: (name: string, force?: boolean) => Promise<void>;
	uninstallVoice: (name: string) => Promise<void>;
	setVoiceRunning: (name: string, running: boolean) => Promise<void>;
	selectSandbox: (name: string) => Promise<void>;
	rowState: (name: string) => RowState;
	patchRow: (name: string, patch: Partial<RowState>) => void;
	runAction: (
		name: string,
		kind: PendingKind,
		action: () => Promise<void>
	) => Promise<void>;
}) {
	if (!selectedId) {
		return (
			<Empty className="h-full">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<HugeiconsIcon icon={CpuIcon} />
					</EmptyMedia>
					<EmptyTitle>No engine selected</EmptyTitle>
					<EmptyDescription>
						Pick an engine on the left to review its status and controls.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	const [kind, name] = selectedId.split(":") as [EngineListKind, string];

	if (kind === "text") {
		if (textLoading) {
			return (
				<div className="flex h-full items-center justify-center text-muted-foreground">
					<Spinner className="size-5" />
				</div>
			);
		}
		const engine = textEngines.find((e) => e.name === name);
		if (!engine) {
			return null;
		}
		const state = rowState(engine.name);
		const isInstalled = engine.installState === "installed";
		const busy = state.pending !== null;
		const unsupported = !engine.supported;

		return (
			<ListingDetailShell
				actions={
					<>
						<LiveEngineInstallButton
							busy={busy || unsupported}
							disabledUninstall={engine.active}
							engineName={engine.name}
							hasUpdate={hasEngineUpdate(engine)}
							installState={engine.installState}
							// Same button installs or updates: force only when the node
							// says a newer build is actually reachable, so a first
							// install keeps its cheap idempotent path.
							onInstall={() =>
								runAction(engine.name, "install", () =>
									installText(engine.name, hasEngineUpdate(engine))
								)
							}
							onUninstall={() =>
								runAction(engine.name, "uninstall", () =>
									uninstallText(engine.name)
								)
							}
							pending={state.pending}
						/>
						<label className="ml-auto flex shrink-0 items-center gap-2 text-sm">
							Active engine
							<Switch
								aria-label={`Set ${engine.displayName} as active engine`}
								checked={engine.active}
								disabled={!isInstalled || busy || unsupported}
								onCheckedChange={() =>
									runAction(engine.name, "toggle", async () => {
										if (engine.active) {
											return;
										}
										const swap = await activateText(engine.name);
										if (!swap.gatewayRefreshed) {
											patchRow(engine.name, { gatewayStale: true });
										}
									})
								}
							/>
						</label>
					</>
				}
				aside={
					<ListingAsideCard title="Information">
						<ListingInfoGrid
							rows={[
								{ label: "Kind", value: GROUP_LABELS.text },
								{ label: "Engine ID", value: engine.name },
								{
									label: "Platforms",
									value: engine.platforms?.join(", ") || "All",
								},
							]}
						/>
					</ListingAsideCard>
				}
				hero={
					<ListingHero
						icon={<HugeiconsIcon className="size-8" icon={CpuIcon} />}
						name={engine.displayName}
						statusIcons={
							<>
								{engine.active ? (
									<StatusBadge kind="active" tone="hero" />
								) : null}
								{unsupported ? (
									<StatusBadge
										kind="unavailable"
										label={
											unsupportedReason(engine.platforms) ??
											"Not supported on this platform"
										}
										tone="hero"
									/>
								) : null}
							</>
						}
						tagline={engine.description}
					/>
				}
				stats={
					<ListingStatStrip
						items={[
							{ label: "Type", value: GROUP_LABELS.text },
							{
								label: "Install",
								value: isInstalled ? "Installed" : "Not installed",
							},
							{ label: "Binding", value: engine.active ? "Active" : "Idle" },
							{
								label: "Supported",
								value: engine.supported ? "Yes" : "No",
							},
						]}
					/>
				}
			>
				<ListingSection title="How this engine behaves">
					<p className="text-muted-foreground text-sm leading-relaxed">
						Text engines are mutually exclusive — only one can be the resident
						engine at a time. Toggling on swaps which engine Core binds local
						agents to.
					</p>
				</ListingSection>
				{engine.name === ACCELERATION_ENGINE && isInstalled && (
					<EngineAccelerationSection />
				)}
				{unsupported && (
					<EngineFootnote>{unsupportedReason(engine.platforms)}</EngineFootnote>
				)}
				{state.gatewayStale && (
					<EngineFootnote tone="amber">
						Engine active, but gateway routing was not refreshed.
					</EngineFootnote>
				)}
				{state.error && (
					<EngineFootnote tone="destructive">{state.error}</EngineFootnote>
				)}
				{textError && (
					<EngineFootnote tone="destructive">{textError}</EngineFootnote>
				)}
			</ListingDetailShell>
		);
	}

	if (kind === "media" || kind === "voice") {
		if (voiceLoading) {
			return (
				<div className="flex h-full items-center justify-center text-muted-foreground">
					<Spinner className="size-5" />
				</div>
			);
		}
		const engine = voiceEngines.find((e) => e.name === name);
		if (!engine) {
			return null;
		}
		const state = rowState(engine.name);
		const isInstalled = engine.installState === "installed";
		const busy = state.pending !== null;

		return (
			<ListingDetailShell
				actions={
					<>
						<LiveEngineInstallButton
							busy={busy}
							disabledUninstall={engine.running}
							engineName={engine.name}
							hasUpdate={hasEngineUpdate(engine)}
							installState={engine.installState}
							onInstall={() =>
								runAction(engine.name, "install", () =>
									installVoice(engine.name, hasEngineUpdate(engine))
								)
							}
							onUninstall={() =>
								runAction(engine.name, "uninstall", () =>
									uninstallVoice(engine.name)
								)
							}
							pending={state.pending}
						/>
						<label className="ml-auto flex shrink-0 items-center gap-2 text-sm">
							Running
							<Switch
								aria-label={`Start or stop ${engine.displayName}`}
								checked={engine.running}
								disabled={!isInstalled || busy}
								onCheckedChange={() =>
									runAction(engine.name, "toggle", () =>
										setVoiceRunning(engine.name, !engine.running)
									)
								}
							/>
						</label>
					</>
				}
				aside={
					<ListingAsideCard title="Information">
						<ListingInfoGrid
							rows={[
								{ label: "Kind", value: GROUP_LABELS[kind] },
								{ label: "Engine ID", value: engine.name },
								{
									label: "Process",
									value: engine.running ? "Running" : "Stopped",
								},
							]}
						/>
					</ListingAsideCard>
				}
				hero={
					<ListingHero
						icon={<HugeiconsIcon className="size-8" icon={CpuIcon} />}
						name={engine.displayName}
						statusIcons={
							engine.running ? (
								<StatusBadge kind="active" label="Running" tone="hero" />
							) : null
						}
						tagline={engine.description}
					/>
				}
				stats={
					<ListingStatStrip
						items={[
							{ label: "Type", value: GROUP_LABELS[kind] },
							{
								label: "Install",
								value: isInstalled ? "Installed" : "Not installed",
							},
							{
								label: "Process",
								value: engine.running ? "Running" : "Stopped",
							},
						]}
					/>
				}
			>
				<ListingSection title="How this engine behaves">
					<p className="text-muted-foreground text-sm leading-relaxed">
						Image and speech engines run alongside the active text engine. Use
						the toggle to start or stop this engine's sidecar process.
					</p>
				</ListingSection>
				{state.error && (
					<EngineFootnote tone="destructive">{state.error}</EngineFootnote>
				)}
				{voiceError && (
					<EngineFootnote tone="destructive">{voiceError}</EngineFootnote>
				)}
			</ListingDetailShell>
		);
	}

	if (kind === "sandbox") {
		if (sandboxLoading) {
			return (
				<div className="flex h-full items-center justify-center text-muted-foreground">
					<Spinner className="size-5" />
				</div>
			);
		}
		const backend = sandboxBackends.find((b) => b.name === name);
		if (!backend) {
			return null;
		}
		const state = rowState(backend.name);
		const busy = state.pending !== null;
		const selectable = backend.supported;

		return (
			<ListingDetailShell
				actions={
					<label className="flex items-center gap-2 text-sm">
						Default backend
						<Switch
							aria-label={`Set ${backend.displayName} as the default sandbox backend`}
							checked={backend.isDefault}
							disabled={!selectable || busy || backend.isDefault}
							onCheckedChange={() =>
								runAction(backend.name, "toggle", async () => {
									if (backend.isDefault) {
										return;
									}
									await selectSandbox(backend.name);
								})
							}
						/>
					</label>
				}
				aside={
					<ListingAsideCard title="Information">
						<ListingInfoGrid
							rows={[
								{ label: "Kind", value: GROUP_LABELS.sandbox },
								{ label: "Backend ID", value: backend.name },
								{
									label: "Detected",
									value: backend.detected ? "Yes" : "No",
								},
							]}
						/>
					</ListingAsideCard>
				}
				hero={
					<ListingHero
						icon={<HugeiconsIcon className="size-8" icon={CpuIcon} />}
						name={backend.displayName}
						statusIcons={
							<>
								{backend.isDefault ? (
									<StatusBadge kind="default" tone="hero" />
								) : null}
								{backend.supported ? null : (
									<StatusBadge
										kind="unavailable"
										label="Not supported on this platform"
										tone="hero"
									/>
								)}
							</>
						}
						tagline={sandboxDescription(backend)}
					/>
				}
				stats={
					<ListingStatStrip
						items={[
							{ label: "Type", value: GROUP_LABELS.sandbox },
							{
								label: "Runtime",
								value: backend.detected ? "Detected" : "Missing",
							},
							{
								label: "Default",
								value: backend.isDefault ? "Yes" : "No",
							},
							{
								label: "Supported",
								value: backend.supported ? "Yes" : "No",
							},
						]}
					/>
				}
			>
				<ListingSection title="How this backend behaves">
					<p className="text-muted-foreground text-sm leading-relaxed">
						Sandbox backends pick the default runtime the sandbox_exec tool uses
						when a call omits an explicit backend. Only one can be the default
						at a time.
					</p>
				</ListingSection>
				{backend.supported && !backend.detected && (
					<EngineFootnote tone="amber">
						Not detected on the node — calls fall back to unavailable until its
						runtime is installed.
					</EngineFootnote>
				)}
				{!backend.supported && (
					<EngineFootnote>
						{unsupportedReason(
							backend.name === "microsandbox" || backend.name === "opensandbox"
								? ["linux", "macos"]
								: []
						)}
					</EngineFootnote>
				)}
				{state.error && (
					<EngineFootnote tone="destructive">{state.error}</EngineFootnote>
				)}
				{sandboxError && (
					<EngineFootnote tone="destructive">{sandboxError}</EngineFootnote>
				)}
			</ListingDetailShell>
		);
	}

	return null;
}

export default function EnginesCatalogSection() {
	// Some engines ship as installed plugins with their own settings (a voice
	// backend, a sandbox provider); the resolver returns null for the rest.
	const settingsOpener = usePluginSettingsOpener();
	const [query, setQuery] = useState("");
	const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const { rowState, patchRow, runAction } = useRowStates();

	const {
		engines: textEngines,
		loading: textLoading,
		error: textError,
		install: installText,
		uninstall: uninstallText,
		activate: activateText,
	} = useEngines();

	const {
		engines: voiceEngines,
		loading: voiceLoading,
		error: voiceError,
		install: installVoice,
		uninstall: uninstallVoice,
		setRunning: setVoiceRunning,
	} = useVoiceEngines(RUN_ALONGSIDE_CATEGORIES);

	const {
		backends: sandboxBackends,
		loading: sandboxLoading,
		error: sandboxError,
		select: selectSandbox,
	} = useSandboxBackends();

	const loading = textLoading || voiceLoading || sandboxLoading;
	const error = textError ?? voiceError ?? sandboxError;

	const groups = useMemo(() => {
		const q = debouncedQuery.trim().toLowerCase();
		const matches = (displayName: string, description: string) =>
			!q ||
			displayName.toLowerCase().includes(q) ||
			description.toLowerCase().includes(q);

		const textItems: EngineListItem[] = textEngines
			.filter((e) => matches(e.displayName, e.description))
			.map((e) => ({
				id: `text:${e.name}`,
				kind: "text" as const,
				name: e.name,
				displayName: e.displayName,
				description: e.description,
				status: e.active ? ({ kind: "active" } as const) : null,
				installState: e.installState,
				installed: e.installState === "installed",
				available: e.supported,
				hasUpdate: hasEngineUpdate(e),
				toggled: e.active,
				// The resident engine can't be removed out from under the node.
				canUninstall: e.installState === "installed" && !e.active,
			}));

		const runAlongside = (
			e: VoiceEngineEntry,
			kind: "media" | "voice"
		): EngineListItem => ({
			id: `${kind}:${e.name}`,
			kind,
			name: e.name,
			displayName: e.displayName,
			description: e.description,
			status: e.running
				? ({ kind: "active", label: "Running" } as const)
				: null,
			installState: e.installState,
			installed: e.installState === "installed",
			available: true,
			hasUpdate: hasEngineUpdate(e),
			toggled: e.running,
			// Stop it before removing it, so a live sidecar is never pulled away.
			canUninstall: e.installState === "installed" && !e.running,
		});

		const mediaItems: EngineListItem[] = voiceEngines
			.filter((e) => e.category === "media")
			.filter((e) => matches(e.displayName, e.description))
			.map((e) => runAlongside(e, "media"));

		const voiceItems: EngineListItem[] = voiceEngines
			.filter((e) => e.category === "voice")
			.filter((e) => matches(e.displayName, e.description))
			.map((e) => runAlongside(e, "voice"));

		const sandboxItems: EngineListItem[] = sandboxBackends
			.filter((b) => matches(b.displayName, sandboxDescription(b)))
			.map((b) => ({
				id: `sandbox:${b.name}`,
				kind: "sandbox" as const,
				name: b.name,
				displayName: b.displayName,
				description: sandboxDescription(b),
				status: b.isDefault ? ({ kind: "default" } as const) : null,
				// Ryu never installs a sandbox backend — its runtime is detected on the
				// node — so the row carries no install lifecycle at all.
				installState: null,
				installed: b.detected,
				available: b.supported,
				hasUpdate: false,
				toggled: b.isDefault,
				canUninstall: false,
			}));

		return [
			{ kind: "text" as const, items: textItems },
			{ kind: "media" as const, items: mediaItems },
			{ kind: "voice" as const, items: voiceItems },
			{ kind: "sandbox" as const, items: sandboxItems },
		].filter((g) => g.items.length > 0);
	}, [textEngines, voiceEngines, sandboxBackends, debouncedQuery]);

	// Card-level lifecycle, so an engine installs / starts / swaps straight from the
	// list — the same affordance Apps and Plugins cards have. Each dispatches on the
	// row's kind to the hook that owns it, and goes through `runAction` so the row's
	// pending + error state is the one the detail panel already shows.
	const handleInstall = (item: EngineListItem) => {
		runAction(item.name, "install", () =>
			item.kind === "text"
				? installText(item.name, item.hasUpdate)
				: installVoice(item.name, item.hasUpdate)
		);
	};

	const handleUninstall = (item: EngineListItem) => {
		runAction(item.name, "uninstall", () =>
			item.kind === "text"
				? uninstallText(item.name)
				: uninstallVoice(item.name)
		);
	};

	const handleToggle = (item: EngineListItem, next: boolean) => {
		runAction(item.name, "toggle", async () => {
			if (item.kind === "text") {
				const swap = await activateText(item.name);
				if (!swap.gatewayRefreshed) {
					patchRow(item.name, { gatewayStale: true });
				}
				return;
			}
			if (item.kind === "sandbox") {
				await selectSandbox(item.name);
				return;
			}
			await setVoiceRunning(item.name, next);
		});
	};

	if (error && groups.length === 0 && !loading) {
		return <EnginesErrorState message={error} />;
	}

	const selectedName = selectedId?.split(":")[1] ?? null;

	return (
		<StoreCatalogLayout
			detail={
				<EngineDetailPanel
					activateText={activateText}
					installText={installText}
					installVoice={installVoice}
					patchRow={patchRow}
					rowState={rowState}
					runAction={runAction}
					sandboxBackends={sandboxBackends}
					sandboxError={sandboxError}
					sandboxLoading={sandboxLoading}
					selectedId={selectedId}
					selectSandbox={selectSandbox}
					setVoiceRunning={setVoiceRunning}
					textEngines={textEngines}
					textError={textError}
					textLoading={textLoading}
					uninstallText={uninstallText}
					uninstallVoice={uninstallVoice}
					voiceEngines={voiceEngines}
					voiceError={voiceError}
					voiceLoading={voiceLoading}
				/>
			}
			detailTitle={selectedName ?? "Engine"}
			hasSelection={selectedId != null}
			list={
				<EngineList
					error={error}
					groups={groups}
					loading={loading}
					onInstall={handleInstall}
					onSelect={setSelectedId}
					onToggle={handleToggle}
					onUninstall={handleUninstall}
					rowState={rowState}
					selectedId={selectedId}
					settingsOpener={settingsOpener}
				/>
			}
			onCloseDetail={() => setSelectedId(null)}
			search={{
				value: query,
				onChange: setQuery,
				placeholder: "Search engines…",
			}}
		/>
	);
}
