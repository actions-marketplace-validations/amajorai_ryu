import { Folder03Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Input } from "@ryu/ui/components/input.tsx";
import { Switch } from "@ryu/ui/components/switch.tsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { SettingsSection } from "@/src/components/settings/shared/settings-items.tsx";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	fetchGatewayGovernance,
	type GovernanceScope,
	updateGatewayGovernance,
	type WorktreeGovernanceSettings,
} from "@/src/lib/api/governance.ts";
import {
	DEFAULT_WORKTREE_SETTINGS,
	resolveWorktreeSetting,
} from "./developer-settings.ts";
import {
	GovernanceScopeSwitcher,
	type GovernanceView,
} from "./GovernanceScopeSwitcher.tsx";

const queryKey = (target: ApiTarget) => [
	"gateway-governance",
	target.url,
	target.token,
];

const writeScopeFor = (
	view: GovernanceView
): Extract<GovernanceScope, "node" | "user"> | null => {
	if (view === "node") {
		return "node";
	}
	if (view === "effective" || view === "user") {
		return "user";
	}
	return null;
};

function WorktreeRow({
	actions,
	description,
	title,
}: {
	actions: ReactNode;
	description: string;
	title: string;
}) {
	return (
		<div className="flex items-center gap-4 border-border/65 border-b px-4 py-3 last:border-b-0">
			<div className="min-w-0 flex-1">
				<p className="font-medium text-sm">{title}</p>
				<p className="mt-0.5 text-muted-foreground text-xs">{description}</p>
			</div>
			<div className="shrink-0">{actions}</div>
		</div>
	);
}

export function WorktreesSection({
	canConfigure,
	target,
}: {
	canConfigure: boolean;
	target: ApiTarget;
}) {
	const queryClient = useQueryClient();
	const [view, setView] = useState<GovernanceView>("effective");
	const [saving, setSaving] = useState(false);
	const query = useQuery({
		queryKey: queryKey(target),
		queryFn: ({ signal }) => fetchGatewayGovernance(target, signal),
	});
	const snapshot = query.data;
	const writeScope = writeScopeFor(view);
	const selectedLayer = snapshot?.layers.find(
		(layer) => layer.scope === writeScope
	);
	const localSettings = selectedLayer?.values.worktrees ?? {};
	const effective = <Key extends keyof WorktreeGovernanceSettings>(key: Key) =>
		resolveWorktreeSetting(snapshot ?? { layers: [], schemaVersion: 1 }, key)
			?.value ?? DEFAULT_WORKTREE_SETTINGS[key];
	const disabled =
		!writeScope || (writeScope === "node" && !canConfigure) || saving;

	const update = async (patch: WorktreeGovernanceSettings) => {
		if (!writeScope) {
			return;
		}
		setSaving(true);
		try {
			const next = await updateGatewayGovernance(
				target,
				"worktrees",
				writeScope,
				{ ...localSettings, ...patch }
			);
			queryClient.setQueryData(queryKey(target), next);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="space-y-6">
			<SettingsSection
				caption="Managed worktrees keep agent changes isolated from the project folder. Filesystem paths belong to the node that owns them."
				title="Worktrees"
			>
				<div className="space-y-4 px-3">
					<GovernanceScopeSwitcher
						layers={snapshot?.layers ?? []}
						onValueChange={setView}
						value={view}
					/>
					<div className="overflow-hidden rounded-2xl border border-border/80 bg-card/45">
						<WorktreeRow
							actions={
								<div className="flex items-center gap-2">
									<HugeiconsIcon
										className="size-4 text-muted-foreground"
										icon={Folder03Icon}
									/>
									<Input
										aria-label="Worktree root"
										className="w-64"
										defaultValue={String(effective("root"))}
										disabled={disabled || writeScope !== "node"}
										onBlur={(event) =>
											update({ root: event.target.value.trim() })
										}
									/>
								</div>
							}
							description="Directory where Ryu creates managed worktrees"
							title="Worktree root"
						/>
						<WorktreeRow
							actions={
								<Switch
									aria-label="Always fetch upstream before creating worktrees"
									checked={Boolean(effective("fetchUpstream"))}
									disabled={disabled}
									onCheckedChange={(checked) =>
										update({ fetchUpstream: checked })
									}
								/>
							}
							description="Fetch branch updates before creating each new worktree"
							title="Always fetch upstream before creating worktrees"
						/>
						<WorktreeRow
							actions={
								<Switch
									aria-label="Automatically delete old worktrees"
									checked={Boolean(effective("autoDelete"))}
									disabled={disabled}
									onCheckedChange={(checked) => update({ autoDelete: checked })}
								/>
							}
							description="Ryu snapshots old worktrees before pruning them"
							title="Automatically delete old worktrees"
						/>
						<WorktreeRow
							actions={
								<Input
									aria-label="Auto-delete limit"
									className="w-24"
									defaultValue={String(effective("autoDeleteLimit"))}
									disabled={disabled}
									inputMode="numeric"
									min={1}
									onBlur={(event) => {
										const value = Number.parseInt(event.target.value, 10);
										if (Number.isInteger(value)) {
											update({ autoDeleteLimit: value });
										}
									}}
								/>
							}
							description="Number of managed worktrees to keep before older ones are pruned"
							title="Auto-delete limit"
						/>
					</div>
				</div>
			</SettingsSection>
			<SettingsSection
				caption="The active project environment still owns setup scripts, variables, and actions. Open a project below to edit those details."
				title="Environment handoff"
			>
				<div className="flex items-center gap-2 px-3 text-muted-foreground text-sm">
					<HugeiconsIcon className="size-4" icon={Refresh01Icon} />
					Project environments run only when a new isolated worktree is created.
				</div>
			</SettingsSection>
		</div>
	);
}
