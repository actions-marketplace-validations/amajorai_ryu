import {
	Download01Icon,
	FolderOpenIcon,
	RefreshIcon,
	Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@ryu/ui/components/badge.tsx";
import { Button } from "@ryu/ui/components/button.tsx";
import { Checkbox } from "@ryu/ui/components/checkbox.tsx";
import { Input } from "@ryu/ui/components/input.tsx";
import { Label } from "@ryu/ui/components/label.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { Switch } from "@ryu/ui/components/switch.tsx";
import { formatCount } from "@ryu/ui/lib/number-format.ts";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	SettingsCard,
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "@/src/components/settings/shared/settings-items.tsx";
import {
	type AgentSyncExportResult,
	type AgentSyncImportResult,
	type AgentSyncProfile,
	type AgentSyncResumeResult,
	type AgentSyncScan,
	type AgentSyncScanItem,
	type AgentSyncStatus,
	exportAgentSyncBundle,
	getAgentSyncStatus,
	importAgentSyncItems,
	importAgentSyncThread,
	listAgentSyncProfiles,
	resolveAgentSyncConflict,
	resumeAgentSyncAcpSession,
	type SyncProvider,
	saveAgentSyncProfile,
	scanAgentSyncRoot,
} from "@/src/lib/api/agent-sync.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import type { ImportSelection } from "@/src/lib/api/import.ts";
import { listDirectory } from "@/src/lib/api/workspace.ts";

const PROVIDERS: { label: string; value: SyncProvider }[] = [
	{ label: "Claude", value: "claude" },
	{ label: "Codex", value: "codex" },
	{ label: "Cursor", value: "cursor" },
];

interface ProfileDraft {
	exportEnabled: boolean;
	id?: string;
	importEnabled: boolean;
	provider: SyncProvider;
	root: string;
}

function useAgentSyncProfiles(target: ApiTarget) {
	const [profiles, setProfiles] = useState<AgentSyncProfile[]>([]);
	const [status, setStatus] = useState<AgentSyncStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [profileResult, statusResult] = await Promise.all([
				listAgentSyncProfiles(target),
				getAgentSyncStatus(target),
			]);
			setProfiles(profileResult.profiles);
			setStatus(statusResult);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not load sync state"
			);
		} finally {
			setLoading(false);
		}
	}, [target]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const save = useCallback(
		async (draft: ProfileDraft) => {
			const saved = await saveAgentSyncProfile(target, draft);
			setProfiles((current) => {
				const next = current.filter((profile) => profile.id !== saved.id);
				return [...next, saved].sort((a, b) => a.root.localeCompare(b.root));
			});
			return saved;
		},
		[target]
	);

	return { error, loading, profiles, refresh, save, status };
}

function providerLabel(provider: SyncProvider): string {
	return PROVIDERS.find((entry) => entry.value === provider)?.label ?? provider;
}

function pathSeparator(path: string): string {
	return path.includes("\\") ? "\\" : "/";
}

function profileKey(profile: AgentSyncProfile): string {
	return `${profile.provider}:${profile.root}`;
}

function ProfileList({
	profiles,
	selectedId,
	onSelect,
	onToggle,
}: {
	onSelect: (profile: AgentSyncProfile) => void;
	onToggle: (
		profile: AgentSyncProfile,
		key: "exportEnabled" | "importEnabled",
		value: boolean
	) => void;
	profiles: AgentSyncProfile[];
	selectedId: string | null;
}) {
	if (profiles.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No sync roots configured yet. Scan a detected root and save it below.
			</p>
		);
	}
	return (
		<SettingsGroup>
			{profiles.map((profile) => (
				<SettingsItem
					actions={
						<div className="flex items-center gap-2">
							<Button onClick={() => onSelect(profile)} variant="outline">
								Use
							</Button>
							<Badge
								variant={
									profile.conflictCount > 0 ? "destructive" : "secondary"
								}
							>
								{profile.conflictCount > 0
									? `${profile.conflictCount} conflicts`
									: profile.status}
							</Badge>
							<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
								<span>Import</span>
								<Switch
									aria-label={`Enable import for ${providerLabel(profile.provider)}`}
									checked={profile.importEnabled}
									onCheckedChange={(checked) =>
										onToggle(profile, "importEnabled", checked)
									}
								/>
								<span>Export</span>
								<Switch
									aria-label={`Enable export for ${providerLabel(profile.provider)}`}
									checked={profile.exportEnabled}
									onCheckedChange={(checked) =>
										onToggle(profile, "exportEnabled", checked)
									}
								/>
							</div>
						</div>
					}
					description={
						<span className="block truncate font-mono text-xs">
							{profile.root}
						</span>
					}
					key={profileKey(profile)}
					title={`${providerLabel(profile.provider)} · ${profile.id === selectedId ? "selected" : "select"}`}
				/>
			))}
		</SettingsGroup>
	);
}

function RootDetection({
	home,
	onScan,
	detected,
}: {
	detected: Set<string>;
	home: string | null;
	onScan: (path: string, provider: SyncProvider) => void;
}) {
	if (!home) {
		return (
			<p className="text-muted-foreground text-sm">
				Detecting this node’s home directory…
			</p>
		);
	}
	const separator = pathSeparator(home);
	return (
		<div className="grid gap-2 sm:grid-cols-3">
			{PROVIDERS.map((provider) => {
				const path = `${home}${separator}.${provider.value}`;
				return (
					<Button
						className="justify-between"
						key={provider.value}
						onClick={() => onScan(path, provider.value)}
						variant="outline"
					>
						<span>{provider.label}</span>
						<Badge variant={detected.has(path) ? "default" : "secondary"}>
							{detected.has(path) ? "detected" : "scan"}
						</Badge>
					</Button>
				);
			})}
		</div>
	);
}

function ScanItems({
	items,
	selected,
	onToggle,
}: {
	items: AgentSyncScanItem[];
	onToggle: (item: AgentSyncScanItem, checked: boolean) => void;
	selected: Set<string>;
}) {
	if (items.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No supported setup items found.
			</p>
		);
	}
	return (
		<div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
			{items.map((item) => {
				const key = `${item.kind}:${item.id}`;
				return (
					<label
						className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
						key={key}
					>
						<Checkbox
							checked={selected.has(key)}
							onCheckedChange={(checked) => onToggle(item, checked === true)}
						/>
						<span className="min-w-0 flex-1">
							<span className="block truncate text-sm">{item.title}</span>
							<span className="block truncate font-mono text-muted-foreground text-xs">
								{item.kind} · {item.id}
							</span>
						</span>
						{item.already_exists ? (
							<Badge variant="secondary">present</Badge>
						) : null}
					</label>
				);
			})}
		</div>
	);
}

function ThreadItems({
	items,
	onToggle,
	selected,
}: {
	items: AgentSyncScan["threads"];
	onToggle: (id: string, checked: boolean) => void;
	selected: Set<string>;
}) {
	if (items.length === 0) {
		return null;
	}
	return (
		<div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
			{items.map((thread) => (
				<label
					className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
					key={thread.id}
				>
					<Checkbox
						checked={selected.has(thread.id)}
						onCheckedChange={(checked) => onToggle(thread.id, checked === true)}
					/>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-sm">{thread.title}</span>
						<span className="block truncate font-mono text-muted-foreground text-xs">
							{thread.native_session_id ?? thread.id} · {thread.message_count}{" "}
							messages
						</span>
					</span>
				</label>
			))}
		</div>
	);
}

function SyncStatusLine({ status }: { status: AgentSyncStatus | null }) {
	if (!status) {
		return null;
	}
	return (
		<div className="flex flex-wrap gap-2 text-muted-foreground text-xs">
			<span>{formatCount(status.profiles.length) ?? "—"} profiles</span>
			<span>·</span>
			<span>{formatCount(status.bindings.length) ?? "—"} ACP bindings</span>
			<span>·</span>
			<span>
				{formatCount(status.activeOperations) ?? "—"} active operations
			</span>
			<span>·</span>
			<span className="font-mono">node {status.nodeId}</span>
		</div>
	);
}

function ConflictList({
	onResolve,
	status,
}: {
	onResolve: (
		item: AgentSyncStatus["items"][number],
		resolution: "keep_external" | "keep_ryu"
	) => void;
	status: AgentSyncStatus | null;
}) {
	const conflicts =
		status?.items.filter((item) => item.state === "conflict") ?? [];
	if (conflicts.length === 0) {
		return null;
	}
	return (
		<div className="space-y-1.5">
			<p className="text-amber-600 text-sm">
				External changes are paused until reviewed.
			</p>
			<SettingsGroup>
				{conflicts.map((item) => (
					<SettingsItem
						actions={
							<div className="flex gap-2">
								<Button
									onClick={() => onResolve(item, "keep_external")}
									variant="outline"
								>
									Keep external
								</Button>
								<Button onClick={() => onResolve(item, "keep_ryu")}>
									Keep Ryu
								</Button>
							</div>
						}
						description={`${item.kind} · ${item.sourceId} · revision ${item.revision}`}
						key={`${item.profileId}:${item.kind}:${item.sourceId}`}
						title="Conflict paused"
					/>
				))}
			</SettingsGroup>
		</div>
	);
}

export function AgentSyncImportSection({ target }: { target: ApiTarget }) {
	const {
		error: profileError,
		loading,
		profiles,
		refresh,
		save,
		status,
	} = useAgentSyncProfiles(target);
	const [home, setHome] = useState<string | null>(null);
	const [detected, setDetected] = useState<Set<string>>(new Set());
	const [selectedProfile, setSelectedProfile] =
		useState<AgentSyncProfile | null>(null);
	const [provider, setProvider] = useState<SyncProvider>("claude");
	const [root, setRoot] = useState("");
	const [scan, setScan] = useState<AgentSyncScan | null>(null);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [selectedThreads, setSelectedThreads] = useState<Set<string>>(
		new Set()
	);
	const [importResult, setImportResult] =
		useState<AgentSyncImportResult | null>(null);
	const [working, setWorking] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void listDirectory(target)
			.then(async (listing) => {
				if (cancelled) {
					return;
				}
				setHome(listing.home);
				const separator = pathSeparator(listing.home);
				const candidates = PROVIDERS.map((entry) => ({
					path: `${listing.home}${separator}.${entry.value}`,
					provider: entry.value,
				}));
				const results = await Promise.allSettled(
					candidates.map((candidate) =>
						scanAgentSyncRoot(target, candidate.path, candidate.provider)
					)
				);
				if (cancelled) {
					return;
				}
				setDetected(
					new Set(
						results.flatMap((result, index) =>
							result.status === "fulfilled" ? [candidates[index].path] : []
						)
					)
				);
			})
			.catch(() => {
				if (!cancelled) {
					setHome(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [target]);

	const onScan = useCallback(
		async (path: string, nextProvider: SyncProvider) => {
			setWorking(true);
			setMessage(null);
			setProvider(nextProvider);
			setRoot(path);
			try {
				const result = await scanAgentSyncRoot(target, path, nextProvider);
				setScan(result);
				setSelected(
					new Set(result.items.map((item) => `${item.kind}:${item.id}`))
				);
				setSelectedThreads(new Set(result.threads.map((thread) => thread.id)));
				setDetected((current) => new Set([...current, path]));
			} catch (cause) {
				setScan(null);
				setMessage(cause instanceof Error ? cause.message : "Scan failed");
			} finally {
				setWorking(false);
			}
		},
		[target]
	);

	const saveCurrentProfile = useCallback(
		async (overrides: Partial<ProfileDraft> = {}) => {
			if (!root.trim()) {
				throw new Error("Choose an agent root first");
			}
			const saved = await save({
				exportEnabled: selectedProfile?.exportEnabled ?? false,
				importEnabled: selectedProfile?.importEnabled ?? true,
				id: selectedProfile?.id,
				provider,
				root,
				...overrides,
			});
			setSelectedProfile(saved);
			return saved;
		},
		[provider, root, save, selectedProfile]
	);

	const toggleProfile = useCallback(
		async (
			profile: AgentSyncProfile,
			key: "exportEnabled" | "importEnabled",
			value: boolean
		) => {
			try {
				await save({
					exportEnabled:
						key === "exportEnabled" ? value : profile.exportEnabled,
					importEnabled:
						key === "importEnabled" ? value : profile.importEnabled,
					id: profile.id,
					provider: profile.provider,
					root: profile.root,
				});
			} catch (cause) {
				setMessage(
					cause instanceof Error ? cause.message : "Could not update profile"
				);
			}
		},
		[save]
	);

	const selectedItems = useMemo<ImportSelection[]>(
		() =>
			(scan?.items ?? [])
				.filter((item) => selected.has(`${item.kind}:${item.id}`))
				.map((item) => ({ id: item.id, kind: item.kind })),
		[scan, selected]
	);

	const runImport = useCallback(
		async (dryRun: boolean) => {
			setWorking(true);
			setMessage(null);
			try {
				const profile = selectedProfile ?? (await saveCurrentProfile());
				const result = await importAgentSyncItems(target, {
					dryRun,
					items: selectedItems,
					path: root,
					profileId: profile.id,
				});
				setImportResult(result);
				setMessage(
					`${dryRun ? "Preview" : "Import"} ${result.operationId}: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed.`
				);
				await refresh();
			} catch (cause) {
				setMessage(cause instanceof Error ? cause.message : "Import failed");
			} finally {
				setWorking(false);
			}
		},
		[refresh, root, saveCurrentProfile, selectedItems, selectedProfile, target]
	);

	const runThreadImport = useCallback(async () => {
		if (!scan?.agentId || selectedThreads.size === 0) {
			return;
		}
		setWorking(true);
		setMessage(null);
		try {
			let added = 0;
			let alreadyImported = 0;
			for (const thread of scan.threads) {
				if (!selectedThreads.has(thread.id)) {
					continue;
				}
				const result = await importAgentSyncThread(target, {
					agentId: scan.agentId,
					threadId: thread.id,
				});
				added += result.messagesAdded;
				if (result.alreadyImported) {
					alreadyImported += 1;
				}
			}
			setMessage(
				`Native thread import complete: ${added} messages added, ${alreadyImported} already linked.`
			);
			await refresh();
		} catch (cause) {
			setMessage(
				cause instanceof Error ? cause.message : "Native thread import failed"
			);
		} finally {
			setWorking(false);
		}
	}, [refresh, scan, selectedThreads, target]);

	return (
		<div className="flex flex-col gap-4">
			<SettingsSection
				caption="Ryu reads Claude, Codex, and Cursor setup roots without changing them. Automatic import is off until you enable it for a saved root."
				title="Import agent setup"
			>
				<SettingsCard className="flex flex-col gap-4">
					<SyncStatusLine status={status} />
					{profileError ? (
						<p className="text-destructive text-sm">{profileError}</p>
					) : null}
					<RootDetection detected={detected} home={home} onScan={onScan} />
					<div className="grid gap-3 sm:grid-cols-[1fr_150px_auto]">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="agent-sync-import-root">Root path</Label>
							<Input
								id="agent-sync-import-root"
								onChange={(event) => setRoot(event.target.value)}
								placeholder="/Users/you/.claude"
								value={root}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="agent-sync-import-provider">Agent</Label>
							<select
								aria-label="Agent provider"
								className="h-9 rounded-md border border-input bg-background px-2 text-sm"
								id="agent-sync-import-provider"
								onChange={(event) =>
									setProvider(event.target.value as SyncProvider)
								}
								value={provider}
							>
								{PROVIDERS.map((entry) => (
									<option key={entry.value} value={entry.value}>
										{entry.label}
									</option>
								))}
							</select>
						</div>
						<Button
							disabled={working || !root.trim()}
							onClick={() => onScan(root, provider)}
						>
							<HugeiconsIcon className="size-4" icon={RefreshIcon} />
							Scan
						</Button>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							disabled={working || !root.trim()}
							onClick={() => void saveCurrentProfile()}
							variant="outline"
						>
							Save root + enable import
						</Button>
						{selectedProfile ? (
							<Badge variant="secondary">profile {selectedProfile.id}</Badge>
						) : null}
					</div>
					{working ? <Spinner className="size-4" /> : null}
				</SettingsCard>
			</SettingsSection>

			{scan ? (
				<SettingsSection
					caption={`${scan.items.length} setup items and ${scan.threads.length} native threads detected. Unsupported native history stays bundle-only.`}
					title="Import preview"
				>
					<SettingsCard className="flex flex-col gap-3">
						<div className="flex flex-wrap gap-2">
							<Badge variant="secondary">{scan.provider}</Badge>
							<Badge
								variant={
									scan.capabilities.nativeThreads ? "default" : "secondary"
								}
							>
								{scan.capabilities.nativeThreads
									? "native threads readable"
									: "bundle-only threads"}
							</Badge>
							<Badge variant="secondary">
								ACP{" "}
								{scan.capabilities.acpLoadResume === true
									? "resume"
									: "replay fallback"}
							</Badge>
						</div>
						<ScanItems
							items={scan.items}
							onToggle={(item, checked) => {
								const key = `${item.kind}:${item.id}`;
								setSelected((current) => {
									const next = new Set(current);
									if (checked) {
										next.add(key);
									} else {
										next.delete(key);
									}
									return next;
								});
							}}
							selected={selected}
						/>
						{scan.threads.length > 0 ? (
							<>
								<div className="flex items-center justify-between gap-2">
									<Label>Native threads</Label>
									<Badge variant={scan.agentId ? "default" : "secondary"}>
										{scan.agentId ? "ACP-backed import" : "agent unavailable"}
									</Badge>
								</div>
								<ThreadItems
									items={scan.threads}
									onToggle={(id, checked) => {
										setSelectedThreads((current) => {
											const next = new Set(current);
											if (checked) {
												next.add(id);
											} else {
												next.delete(id);
											}
											return next;
										});
									}}
									selected={selectedThreads}
								/>
								<Button
									disabled={
										working || !scan.agentId || selectedThreads.size === 0
									}
									onClick={() => void runThreadImport()}
									variant="outline"
								>
									Import selected threads
								</Button>
							</>
						) : null}
						{scan.warnings.map((warning) => (
							<p className="text-amber-600 text-xs" key={warning}>
								{warning}
							</p>
						))}
						<div className="flex flex-wrap gap-2">
							<Button
								disabled={working || selectedItems.length === 0}
								onClick={() => void runImport(true)}
								variant="outline"
							>
								Preview selected
							</Button>
							<Button
								disabled={working || selectedItems.length === 0}
								onClick={() => void runImport(false)}
							>
								<HugeiconsIcon className="size-4" icon={Download01Icon} />
								Import selected
							</Button>
						</div>
						{message ? (
							<p className="text-muted-foreground text-sm">{message}</p>
						) : null}
					</SettingsCard>
				</SettingsSection>
			) : null}
			{importResult ? (
				<SettingsSection
					caption="In-app proof of the last import operation."
					title="Sync proof"
				>
					<SettingsCard className="grid gap-3 sm:grid-cols-2">
						<SettingsItem
							description={`${status?.profiles.length ?? 0} profiles · ${status?.bindings.length ?? 0} ACP bindings`}
							title="Profiles and bindings"
						/>
						<SettingsItem
							description={importResult.operationId}
							title="Operation ID"
						/>
						<SettingsItem
							description={`${importResult.imported} imported · ${importResult.skipped} skipped · ${importResult.failed} failed`}
							title="Imported counts"
						/>
						<SettingsItem
							description={`${importResult.conflicts} conflicts`}
							title="Conflict count"
						/>
						<SettingsItem
							description={`${status?.bindings.filter((binding) => binding.capabilities && JSON.stringify(binding.capabilities).includes("loadSession")).length ?? 0} capability records · replay fallback remains available`}
							title="ACP resume versus replay"
						/>
					</SettingsCard>
				</SettingsSection>
			) : null}

			<SettingsSection
				caption="Import and export switches are independent per root. A generated bundle hash is recorded so retries never create duplicate Ryu items."
				title="Configured roots"
			>
				<SettingsCard>
					{loading ? <Spinner className="size-4" /> : null}
					<ProfileList
						onSelect={(profile) => {
							setSelectedProfile(profile);
							setProvider(profile.provider);
							setRoot(profile.root);
						}}
						onToggle={toggleProfile}
						profiles={profiles}
						selectedId={selectedProfile?.id ?? null}
					/>
				</SettingsCard>
			</SettingsSection>
		</div>
	);
}

export function AgentSyncExportSection({ target }: { target: ApiTarget }) {
	const {
		error: profileError,
		loading,
		profiles,
		refresh,
		save,
		status,
	} = useAgentSyncProfiles(target);
	const [selectedProfile, setSelectedProfile] =
		useState<AgentSyncProfile | null>(null);
	const [destination, setDestination] = useState("");
	const [includeAgents, setIncludeAgents] = useState(true);
	const [includeSkills, setIncludeSkills] = useState(true);
	const [includeConversations, setIncludeConversations] = useState(true);
	const [working, setWorking] = useState(false);
	const [result, setResult] = useState<AgentSyncExportResult | null>(null);
	const [resumeResults, setResumeResults] = useState<AgentSyncResumeResult[]>(
		[]
	);
	const [message, setMessage] = useState<string | null>(null);

	const toggleProfile = useCallback(
		async (
			profile: AgentSyncProfile,
			key: "exportEnabled" | "importEnabled",
			value: boolean
		) => {
			try {
				await save({
					exportEnabled:
						key === "exportEnabled" ? value : profile.exportEnabled,
					importEnabled:
						key === "importEnabled" ? value : profile.importEnabled,
					id: profile.id,
					provider: profile.provider,
					root: profile.root,
				});
			} catch (cause) {
				setMessage(
					cause instanceof Error ? cause.message : "Could not update profile"
				);
			}
		},
		[save]
	);

	const runExport = useCallback(
		async (dryRun: boolean) => {
			setWorking(true);
			setMessage(null);
			try {
				if (!destination.trim()) {
					throw new Error("Choose an explicit destination folder");
				}
				const exportResult = await exportAgentSyncBundle(target, {
					destination,
					dryRun,
					includeAgents,
					includeConversations,
					includeSkills,
					profileId: selectedProfile?.id,
				});
				setResult(exportResult);
				setMessage(
					`${dryRun ? "Preview" : "Export"} ${exportResult.operationId} · ${exportResult.bundleHash}`
				);
				await refresh();
			} catch (cause) {
				setMessage(cause instanceof Error ? cause.message : "Export failed");
			} finally {
				setWorking(false);
			}
		},
		[
			destination,
			includeAgents,
			includeConversations,
			includeSkills,
			refresh,
			selectedProfile,
			target,
		]
	);

	const runAcpResume = useCallback(async () => {
		if (!status || status.bindings.length === 0) {
			return;
		}
		setWorking(true);
		setMessage(null);
		try {
			const results: AgentSyncResumeResult[] = [];
			for (const binding of status.bindings) {
				results.push(
					await resumeAgentSyncAcpSession(target, binding.conversationId)
				);
			}
			setResumeResults(results);
			const loaded = results.filter((entry) => entry.mode !== "replay").length;
			setMessage(
				`${loaded} ACP sessions loaded/resumed, ${results.length - loaded} transcript replays.`
			);
		} catch (cause) {
			setMessage(
				cause instanceof Error ? cause.message : "ACP resume probe failed"
			);
		} finally {
			setWorking(false);
		}
	}, [status, target]);

	const resolveConflict = useCallback(
		async (
			item: AgentSyncStatus["items"][number],
			resolution: "keep_external" | "keep_ryu"
		) => {
			try {
				await resolveAgentSyncConflict(target, {
					itemId: item.sourceId,
					kind: item.kind,
					profileId: item.profileId,
					resolution,
				});
				await refresh();
			} catch (cause) {
				setMessage(
					cause instanceof Error ? cause.message : "Could not resolve conflict"
				);
			}
		},
		[refresh, target]
	);

	return (
		<div className="flex flex-col gap-4">
			<SettingsSection
				caption="Export is opt-in and writes one versioned portable bundle to the destination you choose. Ryu never fabricates Claude, Codex, or Cursor transcript files."
				title="Export Ryu data"
			>
				<SettingsCard className="flex flex-col gap-4">
					<SyncStatusLine status={status} />
					{profileError ? (
						<p className="text-destructive text-sm">{profileError}</p>
					) : null}
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="agent-sync-export-destination">
							Destination folder
						</Label>
						<div className="flex gap-2">
							<Input
								id="agent-sync-export-destination"
								onChange={(event) => setDestination(event.target.value)}
								placeholder="/Users/you/.claude"
								value={destination}
							/>
							<Button
								disabled={!selectedProfile}
								onClick={() => setDestination(selectedProfile?.root ?? "")}
								variant="outline"
							>
								<HugeiconsIcon className="size-4" icon={FolderOpenIcon} />
								Use selected root
							</Button>
						</div>
					</div>
					<div className="grid gap-2 sm:grid-cols-3">
						<label className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
							<Checkbox
								checked={includeAgents}
								onCheckedChange={(checked) =>
									setIncludeAgents(checked === true)
								}
							/>
							Agent definitions
						</label>
						<label className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
							<Checkbox
								checked={includeConversations}
								onCheckedChange={(checked) =>
									setIncludeConversations(checked === true)
								}
							/>
							Conversation transcripts
						</label>
						<label className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
							<Checkbox
								checked={includeSkills}
								onCheckedChange={(checked) =>
									setIncludeSkills(checked === true)
								}
							/>
							Agent Skills
						</label>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							disabled={working || !destination.trim()}
							onClick={() => void runExport(true)}
							variant="outline"
						>
							Preview bundle
						</Button>
						<Button
							disabled={working || !destination.trim()}
							onClick={() => void runExport(false)}
						>
							<HugeiconsIcon className="size-4" icon={Upload01Icon} />
							Export bundle
						</Button>
						<Button
							disabled={working || (status?.bindings.length ?? 0) === 0}
							onClick={() => void runAcpResume()}
							variant="outline"
						>
							Test ACP resume/load
						</Button>
						{working ? <Spinner className="size-4" /> : null}
					</div>
					{message ? (
						<p className="text-muted-foreground text-sm">{message}</p>
					) : null}
				</SettingsCard>
			</SettingsSection>

			<SettingsSection
				caption="Select a profile to persist export automation for that destination. Native setup projections are limited to supported, explicitly selected formats; conversations remain in the bundle."
				title="Export destinations"
			>
				<SettingsCard>
					{loading ? <Spinner className="size-4" /> : null}
					<ProfileList
						onSelect={(profile) => {
							setSelectedProfile(profile);
							setDestination(profile.root);
						}}
						onToggle={toggleProfile}
						profiles={profiles}
						selectedId={selectedProfile?.id ?? null}
					/>
				</SettingsCard>
			</SettingsSection>

			{result ? (
				<SettingsSection
					caption="This is the in-app verification record for the last operation."
					title="Sync proof"
				>
					<SettingsCard className="grid gap-3 sm:grid-cols-2">
						<SettingsItem
							description={result.operationId}
							title="Operation ID"
						/>
						<SettingsItem
							description={result.bundleHash}
							title="Bundle SHA-256"
						/>
						<SettingsItem
							description={`${result.agents} agents · ${result.skills} skills · ${result.conversations} conversations · ${result.messages} messages`}
							title="Projected counts"
						/>
						<SettingsItem
							description={`${result.acpResume.filter((entry) => entry.mode !== "replay").length} ACP loads/resumes · ${result.acpResume.filter((entry) => entry.mode === "replay").length} transcript replays`}
							title="ACP persistence"
						/>
						<SettingsItem description={result.bundlePath} title="Bundle path" />
						<SettingsItem
							description={`${result.conflicts} conflicts · ${result.projectedFiles} files written`}
							title="Safety result"
						/>
						{resumeResults.length > 0 ? (
							<SettingsItem
								description={`${resumeResults.filter((entry) => entry.mode !== "replay").length} load/resume · ${resumeResults.filter((entry) => entry.mode === "replay").length} replay fallback`}
								title="ACP resume proof"
							/>
						) : null}
					</SettingsCard>
				</SettingsSection>
			) : null}
			<SettingsSection
				caption="Ryu preserves conflicting output until you make an explicit choice."
				title="Conflicts"
			>
				<SettingsCard>
					<ConflictList
						onResolve={(item, resolution) =>
							void resolveConflict(item, resolution)
						}
						status={status}
					/>
				</SettingsCard>
			</SettingsSection>
		</div>
	);
}
