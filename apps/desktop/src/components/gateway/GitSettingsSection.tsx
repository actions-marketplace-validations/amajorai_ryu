import { Input } from "@ryu/ui/components/input.tsx";
import { Switch } from "@ryu/ui/components/switch.tsx";
import { Textarea } from "@ryu/ui/components/textarea.tsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { SettingsSection } from "@/src/components/settings/shared/settings-items.tsx";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	fetchGatewayGovernance,
	type GitGovernanceSettings,
	type GovernanceScope,
	updateGatewayGovernance,
} from "@/src/lib/api/governance.ts";
import {
	DEFAULT_GIT_SETTINGS,
	resolveGitSetting,
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

function ChoiceButtons<Value extends string>({
	disabled,
	onChange,
	options,
	value,
}: {
	disabled: boolean;
	onChange: (value: Value) => void;
	options: ReadonlyArray<{ label: string; value: Value }>;
	value: Value;
}) {
	return (
		<div className="flex items-center gap-1 rounded-full bg-muted p-1">
			{options.map((option) => (
				<button
					aria-pressed={value === option.value}
					className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
						value === option.value
							? "bg-background font-medium text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground"
					}`}
					disabled={disabled}
					key={option.value}
					onClick={() => onChange(option.value)}
					type="button"
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

function GitRow({
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

function GitTextArea({
	disabled,
	onCommit,
	onPullRequest,
	onWatch,
	settings,
}: {
	disabled: boolean;
	onCommit: (value: string) => void;
	onPullRequest: (value: string) => void;
	onWatch: (value: string) => void;
	settings: GitGovernanceSettings;
}) {
	return (
		<div className="space-y-5">
			<div className="space-y-2">
				<label className="font-medium text-sm" htmlFor="git-watch-instructions">
					Watch and fix pull requests
				</label>
				<p className="text-muted-foreground text-xs">
					Guidance added when Ryu watches a pull request.
				</p>
				<Textarea
					defaultValue={settings.watchInstructions ?? ""}
					disabled={disabled}
					id="git-watch-instructions"
					onBlur={(event) => onWatch(event.target.value)}
					placeholder="For example: Comment /merge after checks pass and approve unrelated changes…"
				/>
			</div>
			<div className="space-y-2">
				<label
					className="font-medium text-sm"
					htmlFor="git-commit-instructions"
				>
					Commit instructions
				</label>
				<p className="text-muted-foreground text-xs">
					Guidance added to commit message generation prompts.
				</p>
				<Textarea
					defaultValue={settings.commitInstructions ?? ""}
					disabled={disabled}
					id="git-commit-instructions"
					onBlur={(event) => onCommit(event.target.value)}
					placeholder="Add commit message guidance…"
				/>
			</div>
			<div className="space-y-2">
				<label className="font-medium text-sm" htmlFor="git-pr-instructions">
					Pull request instructions
				</label>
				<p className="text-muted-foreground text-xs">
					Guidance added to pull request title and description prompts.
				</p>
				<Textarea
					defaultValue={settings.pullRequestInstructions ?? ""}
					disabled={disabled}
					id="git-pr-instructions"
					onBlur={(event) => onPullRequest(event.target.value)}
					placeholder="Add pull request guidance…"
				/>
			</div>
		</div>
	);
}

export function GitSettingsSection({
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
	const localSettings = selectedLayer?.values.git ?? {};
	const effective = <Key extends keyof GitGovernanceSettings>(key: Key) =>
		resolveGitSetting(snapshot ?? { layers: [], schemaVersion: 1 }, key)
			?.value ?? DEFAULT_GIT_SETTINGS[key];
	const disabled =
		!writeScope || (writeScope === "node" && !canConfigure) || saving;

	const update = async (patch: GitGovernanceSettings) => {
		if (!writeScope) {
			return;
		}
		setSaving(true);
		try {
			const next = await updateGatewayGovernance(target, "git", writeScope, {
				...localSettings,
				...patch,
			});
			queryClient.setQueryData(queryKey(target), next);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="space-y-6">
			<SettingsSection
				caption="Defaults for the Git actions Ryu can perform from a project. Prompt guidance is treated as text and never executed as a command."
				title="Git"
			>
				<div className="space-y-4 px-3">
					<GovernanceScopeSwitcher
						layers={snapshot?.layers ?? []}
						onValueChange={setView}
						value={view}
					/>
					<div className="overflow-hidden rounded-2xl border border-border/80 bg-card/45">
						<GitRow
							actions={
								<Input
									aria-label="Branch prefix"
									className="w-36"
									defaultValue={String(effective("branchPrefix"))}
									disabled={disabled}
									onBlur={(event) =>
										update({ branchPrefix: event.target.value.trim() })
									}
								/>
							}
							description="Prefix used when Ryu creates new branches"
							title="Branch prefix"
						/>
						<GitRow
							actions={
								<ChoiceButtons
									disabled={disabled}
									onChange={(mergeMethod) => update({ mergeMethod })}
									options={[
										{ label: "Merge", value: "merge" },
										{ label: "Squash", value: "squash" },
									]}
									value={
										effective("mergeMethod") === "squash" ? "squash" : "merge"
									}
								/>
							}
							description="Choose how Ryu merges pull requests"
							title="Pull request merge method"
						/>
						<GitRow
							actions={
								<Switch
									aria-label="Always force push"
									checked={Boolean(effective("alwaysForcePush"))}
									disabled={disabled}
									onCheckedChange={(checked) =>
										update({ alwaysForcePush: checked })
									}
								/>
							}
							description="Use force-with-lease when pushing from Ryu"
							title="Always force push"
						/>
						<GitRow
							actions={
								<Switch
									aria-label="Create draft pull requests"
									checked={Boolean(effective("createDraftPullRequests"))}
									disabled={disabled}
									onCheckedChange={(checked) =>
										update({ createDraftPullRequests: checked })
									}
								/>
							}
							description="Use draft pull requests by default when creating PRs"
							title="Create draft pull requests"
						/>
						<GitRow
							actions={
								<ChoiceButtons
									disabled={disabled}
									onChange={(reviewDelivery) => update({ reviewDelivery })}
									options={[
										{ label: "Inline", value: "inline" },
										{ label: "Detached", value: "detached" },
									]}
									value={
										effective("reviewDelivery") === "detached"
											? "detached"
											: "inline"
									}
								/>
							}
							description="Start review in the current chat or a separate review chat"
							title="Review delivery"
						/>
					</div>
				</div>
			</SettingsSection>

			<SettingsSection
				caption="These controls keep pull-request automation explicit. Ryu will not merge unrelated changes without the instructions you provide."
				title="Watch and fix pull requests"
			>
				<div className="space-y-4 px-3">
					<GitRow
						actions={
							<Switch
								aria-label="Auto-merge when ready"
								checked={Boolean(effective("autoMergeWhenReady"))}
								disabled={disabled}
								onCheckedChange={(checked) =>
									update({ autoMergeWhenReady: checked })
								}
							/>
						}
						description="Continue watching until the pull request is merged"
						title="Auto-merge when ready"
					/>
					<div className="space-y-5 rounded-2xl border border-border/70 bg-card/35 p-4">
						{writeScope ? (
							<GitTextArea
								disabled={disabled}
								onCommit={(commitInstructions) =>
									update({ commitInstructions })
								}
								onPullRequest={(pullRequestInstructions) =>
									update({ pullRequestInstructions })
								}
								onWatch={(watchInstructions) => update({ watchInstructions })}
								settings={localSettings}
							/>
						) : (
							<p className="text-muted-foreground text-sm">
								Select User or Node to edit local instructions.
							</p>
						)}
					</div>
				</div>
			</SettingsSection>
		</div>
	);
}
