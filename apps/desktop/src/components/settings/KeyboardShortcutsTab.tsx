// Settings → Keyboard Shortcuts.
//
// The single place to see and customize every shortcut at once. In-app actions
// are edited through the @ryu/hotkeys registry (rebind / clear / reset, with live
// conflict detection); the reset-all button reverts them all to defaults. The
// OS-level "Global" shortcuts are edited in place too, writing the same island /
// voice preferences their dedicated tabs use, so this tab stays the one surface
// without forking the native re-registration logic.

import {
	type Chord,
	chordFromElectron,
	chordTokens,
	eventToChord,
	toElectronAccelerator,
} from "@ryu/hotkeys/chord";
import { useHotkeysAdmin } from "@ryu/hotkeys/react";
import { groupByCategory, type HotkeyAction } from "@ryu/hotkeys/registry";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@ryu/ui/components/alert-dialog";
import { Button } from "@ryu/ui/components/button";
import { Input } from "@ryu/ui/components/input";
import { Kbd } from "@ryu/ui/components/kbd";
import { toast } from "@ryu/ui/components/sileo";
import { useCallback, useEffect, useState } from "react";
import { useApps } from "@/src/hooks/useApps.ts";
import { usePluginContributions } from "@/src/hooks/usePluginContributions.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	DEFAULT_DICTATION_PREFS,
	// # 0.1.0: Island disabled — restore with the Island GlobalRows below
	// DEFAULT_ISLAND_COMMAND_SHORTCUT,
	// DEFAULT_VOICE_PREFS,
	getDictationPrefs,
	getPreference,
	// getIslandCommandShortcut,
	// getVoiceInputPrefs,
	setDictationPrefs,
	setPreference,
	// setIslandCommandShortcut,
	// setVoiceInputPrefs,
} from "@/src/lib/api/preferences.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import { QuickCaptureSettings } from "./QuickCaptureSettings.tsx";
import {
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

function activeTarget() {
	return toTarget(useNodeStore.getState().getActiveNode());
}

const PLUGIN_SHORTCUTS_KEY = "keybindings";

function readShortcutOverrides(
	raw: string | null
): Record<string, string | null> {
	if (!raw) {
		return {};
	}
	try {
		const value: unknown = JSON.parse(raw);
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, string | null>)
			: {};
	} catch {
		return {};
	}
}

/** Render a chord as keycaps, or a muted "Unbound" when null. */
function ChordCaps({ chord }: { chord: Chord | null }) {
	if (!chord) {
		return <span className="text-muted-foreground text-xs">Unbound</span>;
	}
	return (
		<span className="flex items-center gap-1">
			{chordTokens(chord).map((token, index) => (
				<Kbd key={`${index}-${token}`}>{token}</Kbd>
			))}
		</span>
	);
}

interface ChordRecorderProps {
	conflicting?: boolean;
	onChange: (chord: Chord) => void;
	value: Chord | null;
}

/** A keycap button that records the next chord in canonical cross-platform form. */
function ChordRecorder({ value, onChange, conflicting }: ChordRecorderProps) {
	const [capturing, setCapturing] = useState(false);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (!capturing) {
			return;
		}
		e.preventDefault();
		if (e.key === "Escape") {
			setCapturing(false);
			return;
		}
		const chord = eventToChord(e.nativeEvent);
		if (chord) {
			onChange(chord);
			setCapturing(false);
		}
	};

	return (
		<button
			className={`flex min-w-32 items-center justify-center gap-1 rounded-md bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring ${conflicting ? "ring-2 ring-destructive" : ""}`}
			onBlur={() => setCapturing(false)}
			onClick={() => setCapturing(true)}
			onKeyDown={handleKeyDown}
			type="button"
		>
			{capturing ? (
				<span className="text-muted-foreground text-xs">Press keys…</span>
			) : (
				<ChordCaps chord={value} />
			)}
		</button>
	);
}

interface InAppRowProps {
	action: HotkeyAction;
	binding: Chord | null;
	conflictLabels: string[];
	hasOverride: boolean;
	onChange: (chord: Chord) => void;
	onClear: () => void;
	onReset: () => void;
}

/** One editable in-app shortcut row. */
function InAppRow({
	action,
	binding,
	hasOverride,
	conflictLabels,
	onChange,
	onClear,
	onReset,
}: InAppRowProps) {
	return (
		<SettingsItem
			actions={
				<div className="flex items-center gap-1.5">
					<ChordRecorder
						conflicting={conflictLabels.length > 0}
						onChange={onChange}
						value={binding}
					/>
					<Button
						disabled={binding === null}
						onClick={onClear}
						size="sm"
						variant="ghost"
					>
						Clear
					</Button>
					<Button
						disabled={!hasOverride}
						onClick={onReset}
						size="sm"
						variant="ghost"
					>
						Reset
					</Button>
				</div>
			}
			title={
				<span className="flex flex-col gap-0.5">
					<span>{action.label}</span>
					{conflictLabels.length > 0 ? (
						<span className="text-destructive text-xs">
							Also bound to {conflictLabels.join(", ")}
						</span>
					) : null}
				</span>
			}
		/>
	);
}

interface GlobalRowProps {
	defaultAccelerator: string;
	description: string;
	label: string;
	load: () => Promise<string>;
	save: (accelerator: string) => Promise<boolean>;
}

/** A system-wide shortcut row, editing the real island/voice preference. */
function GlobalRow({
	label,
	description,
	defaultAccelerator,
	load,
	save,
}: GlobalRowProps) {
	const [accelerator, setAccelerator] = useState<string>(defaultAccelerator);

	useEffect(() => {
		let active = true;
		load().then((value) => {
			if (active) {
				setAccelerator(value);
			}
		});
		return () => {
			active = false;
		};
	}, [load]);

	const persist = useCallback(
		async (next: string) => {
			setAccelerator(next);
			const ok = await save(next);
			if (!ok) {
				toast.error({ title: `Couldn't update ${label}` });
			}
		},
		[label, save]
	);

	return (
		<SettingsItem
			actions={
				<div className="flex items-center gap-1.5">
					<ChordRecorder
						onChange={(chord) => persist(toElectronAccelerator(chord))}
						value={chordFromElectron(accelerator)}
					/>
					<Button
						disabled={accelerator === defaultAccelerator}
						onClick={() => persist(defaultAccelerator)}
						size="sm"
						variant="ghost"
					>
						Reset
					</Button>
				</div>
			}
			title={
				<span className="flex flex-col gap-0.5">
					<span>{label}</span>
					<span className="text-muted-foreground text-xs">{description}</span>
				</span>
			}
		/>
	);
}

export function KeyboardShortcutsTab() {
	const {
		registry,
		bindings,
		overrides,
		conflicts,
		setOverride,
		reset,
		resetAll,
	} = useHotkeysAdmin();

	const inAppGroups = groupByCategory(registry.filter((a) => !a.global));
	const { apps } = useApps();
	const { companions } = usePluginContributions();
	const [pluginOverrides, setPluginOverrides] = useState<
		Record<string, string | null>
	>({});
	const [resetDialogOpen, setResetDialogOpen] = useState(false);
	const [search, setSearch] = useState("");

	useEffect(() => {
		getPreference(activeTarget(), PLUGIN_SHORTCUTS_KEY).then((raw) =>
			setPluginOverrides(readShortcutOverrides(raw))
		);
	}, []);

	const shortcutApps = apps
		.map((app) => {
			const companion = companions.find((entry) => entry.pluginId === app.id);
			const declared = companion?.shortcut ?? app.companion?.shortcut ?? null;
			return declared ? { app, companion, declared } : null;
		})
		.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
		.sort((a, b) => a.app.name.localeCompare(b.app.name));

	const query = search.trim().toLowerCase();
	const matchesSearch = (...values: Array<string | null | undefined>) =>
		query.length === 0 ||
		values.some((value) => value?.toLowerCase().includes(query) === true);
	const filteredInAppGroups = inAppGroups
		.map((group) => ({
			...group,
			actions: group.actions.filter((action) => {
				const binding = bindings.get(action.id);
				return matchesSearch(
					action.category,
					action.description,
					action.id,
					action.label,
					binding ? chordTokens(binding).join(" ") : "unbound"
				);
			}),
		}))
		.filter((group) => group.actions.length > 0);

	const matchesGlobalSearch = (
		label: string,
		description: string,
		accelerator: string
	) =>
		matchesSearch(
			"global",
			label,
			description,
			accelerator,
			accelerator.replaceAll("+", " ")
		);
	const showGlobalDictation = matchesGlobalSearch(
		"System-Wide Dictation",
		"Dictate into the focused app (Dictation plugin).",
		DEFAULT_DICTATION_PREFS.shortcut
	);
	const showGlobalAgentAsk = matchesGlobalSearch(
		"Agent Ask",
		"Speak a question; paste the agent answer (Dictation → Agent ask).",
		DEFAULT_DICTATION_PREFS.ask.shortcut
	);

	const visibleShortcutApps = shortcutApps.filter(
		({ app, companion, declared }) => {
			const actionId = `plugin:${app.id}`;
			const configured = Object.hasOwn(pluginOverrides, actionId)
				? pluginOverrides[actionId]
				: declared;
			return matchesSearch(
				"plugins and apps",
				app.name,
				app.id,
				companion?.label,
				declared,
				configured
			);
		}
	);
	const showPluginsSection =
		query.length === 0 ||
		(matchesSearch(
			"plugins and apps",
			"No enabled plugins or apps currently declare a shortcut."
		) &&
			(query.length > 0
				? shortcutApps.length === 0 || visibleShortcutApps.length > 0
				: true));
	const showQuickCapture = matchesSearch(
		"quick capture",
		"keep the selection with a double-tap of shift",
		"which shift",
		"input monitoring",
		"accessibility",
		"quests app",
		"permissions"
	);
	const hasMatches =
		filteredInAppGroups.length > 0 ||
		showGlobalDictation ||
		showGlobalAgentAsk ||
		(showPluginsSection &&
			(shortcutApps.length === 0 || visibleShortcutApps.length > 0)) ||
		showQuickCapture;

	const savePluginShortcut = async (appId: string, chord: Chord | null) => {
		const actionId = `plugin:${appId}`;
		const next = {
			...pluginOverrides,
			[actionId]: chord ? toElectronAccelerator(chord) : null,
		};
		setPluginOverrides(next);
		const ok = await setPreference(
			activeTarget(),
			PLUGIN_SHORTCUTS_KEY,
			JSON.stringify(next)
		);
		if (!ok) {
			toast.error({ title: "Couldn't update plugin shortcut" });
		}
	};

	// Look up the labels of the OTHER actions a chord collides with, for a row.
	const conflictLabelsFor = (action: HotkeyAction): string[] => {
		const binding = bindings.get(action.id);
		if (!binding) {
			return [];
		}
		const ids = conflicts.get(binding);
		if (!ids) {
			return [];
		}
		return ids
			.filter((id) => id !== action.id)
			.map((id) => registry.find((a) => a.id === id)?.label ?? id);
	};

	return (
		<div className="flex h-full min-h-0 flex-col gap-4">
			<div className="flex items-center gap-2">
				<Input
					aria-label="Filter keyboard shortcuts"
					className="min-w-0 flex-1"
					data-testid="keyboard-shortcuts-filter"
					onChange={(event) => setSearch(event.target.value)}
					placeholder="Search"
					size="lg"
					value={search}
				/>

				<AlertDialog
					onOpenChange={(open) => setResetDialogOpen(open)}
					open={resetDialogOpen}
				>
					<AlertDialogTrigger
						render={
							<Button
								data-testid="keyboard-shortcuts-reset-all"
								size="sm"
								variant="default"
							>
								Reset all to defaults
							</Button>
						}
					/>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								Reset all shortcuts to defaults?
							</AlertDialogTitle>
							<AlertDialogDescription>
								Every in-app shortcut returns to its default. Cleared and custom
								bindings are removed. This can't be undone.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								onClick={() => {
									resetAll();
									setResetDialogOpen(false);
								}}
							>
								Reset all to defaults
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>

			<div
				className="scroll-fade min-h-0 flex-1 overflow-y-auto pr-2"
				data-testid="keyboard-shortcuts-scroll"
			>
				<div className="space-y-6">
					{filteredInAppGroups.map((group) => (
						<SettingsSection key={group.category} title={group.category}>
							<SettingsGroup>
								{group.actions.map((action) => (
									<InAppRow
										action={action}
										binding={bindings.get(action.id) ?? null}
										conflictLabels={conflictLabelsFor(action)}
										hasOverride={Object.hasOwn(overrides, action.id)}
										key={action.id}
										onChange={(chord) => setOverride(action.id, chord)}
										onClear={() => setOverride(action.id, null)}
										onReset={() => reset(action.id)}
									/>
								))}
							</SettingsGroup>
						</SettingsSection>
					))}

					{showGlobalDictation || showGlobalAgentAsk ? (
						<SettingsSection
							caption="System-wide shortcuts work anywhere on your desktop and are managed by the island companion."
							title="Global"
						>
							<SettingsGroup>
								{/* # 0.1.0: Island disabled — uncomment when re-enabling Island
					<GlobalRow
						defaultAccelerator={DEFAULT_ISLAND_COMMAND_SHORTCUT}
						description="Open the island command bar from anywhere."
						label="Summon Command Bar"
						load={() => getIslandCommandShortcut(activeTarget())}
						save={(acc) => setIslandCommandShortcut(activeTarget(), acc)}
					/>
					<GlobalRow
						defaultAccelerator={DEFAULT_VOICE_PREFS.shortcut}
						description="Hold to dictate a voice message into the island."
						label="Push-To-Talk"
						load={() =>
							getVoiceInputPrefs(activeTarget()).then((p) => p.shortcut)
						}
						save={async (acc) => {
							const prefs = await getVoiceInputPrefs(activeTarget());
							return setVoiceInputPrefs(activeTarget(), {
								...prefs,
								shortcut: acc,
							});
						}}
					/>
					*/}
								{showGlobalDictation ? (
									<GlobalRow
										defaultAccelerator={DEFAULT_DICTATION_PREFS.shortcut}
										description="Dictate into the focused app (Dictation plugin)."
										label="System-Wide Dictation"
										load={() =>
											getDictationPrefs(activeTarget()).then((p) => p.shortcut)
										}
										save={async (acc) => {
											const prefs = await getDictationPrefs(activeTarget());
											return setDictationPrefs(activeTarget(), {
												...prefs,
												shortcut: acc,
											});
										}}
									/>
								) : null}
								{showGlobalAgentAsk ? (
									<GlobalRow
										defaultAccelerator={DEFAULT_DICTATION_PREFS.ask.shortcut}
										description="Speak a question; paste the agent answer (Dictation → Agent ask)."
										label="Agent Ask"
										load={() =>
											getDictationPrefs(activeTarget()).then(
												(p) => p.ask.shortcut
											)
										}
										save={async (acc) => {
											const prefs = await getDictationPrefs(activeTarget());
											return setDictationPrefs(activeTarget(), {
												...prefs,
												ask: { ...prefs.ask, shortcut: acc },
											});
										}}
									/>
								) : null}
							</SettingsGroup>
						</SettingsSection>
					) : null}

					{showPluginsSection ? (
						<SettingsSection
							caption="Shortcuts contributed by enabled plugins and apps. Changes apply to the Island global shortcut bridge."
							title="Plugins and apps"
						>
							{shortcutApps.length === 0 ? (
								<p className="px-3 text-muted-foreground text-sm">
									No enabled plugins or apps currently declare a shortcut.
								</p>
							) : (
								visibleShortcutApps.map(({ app, companion, declared }) => {
									const actionId = `plugin:${app.id}`;
									const configured = Object.hasOwn(pluginOverrides, actionId)
										? pluginOverrides[actionId]
										: declared;
									return (
										<SettingsSection key={app.id} title={app.name}>
											<SettingsGroup>
												<SettingsItem
													actions={
														<div className="flex items-center gap-1.5">
															<ChordRecorder
																onChange={(chord) =>
																	savePluginShortcut(app.id, chord)
																}
																value={
																	configured
																		? chordFromElectron(configured)
																		: null
																}
															/>
															<Button
																disabled={
																	!Object.hasOwn(pluginOverrides, actionId)
																}
																onClick={() => {
																	const next = { ...pluginOverrides };
																	delete next[actionId];
																	setPluginOverrides(next);
																	setPreference(
																		activeTarget(),
																		PLUGIN_SHORTCUTS_KEY,
																		JSON.stringify(next)
																	);
																}}
																size="sm"
																variant="ghost"
															>
																Reset
															</Button>
														</div>
													}
													title={
														<span className="flex flex-col gap-0.5">
															<span>{companion?.label ?? app.name}</span>
															<span className="text-muted-foreground text-xs">
																{app.id}
															</span>
														</span>
													}
												/>
											</SettingsGroup>
										</SettingsSection>
									);
								})
							)}
						</SettingsSection>
					) : null}

					{/* The one "shortcut" that is not an accelerator: a bare-modifier double
			    tap, owned by the native layer rather than the hotkey registry. */}
					{showQuickCapture ? <QuickCaptureSettings /> : null}

					{query.length > 0 && !hasMatches ? (
						<p className="px-3 text-muted-foreground text-sm">
							No keyboard shortcuts match “{search.trim()}”.
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
}
