import {
	Alert02Icon,
	ArrowDown01Icon,
	CodeCircleIcon,
	Refresh01Icon,
	Shield01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@ryu/ui/components/badge.tsx";
import { Button } from "@ryu/ui/components/button.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@ryu/ui/components/collapsible.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { Switch } from "@ryu/ui/components/switch.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SettingsSection } from "@/src/components/settings/shared/settings-items.tsx";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	fetchGatewayGovernance,
	type GovernanceScope,
	type HookPolicyOverride,
} from "@/src/lib/api/governance.ts";
import {
	fetchHookInventory,
	type HookInventory,
	type HookInventoryItem,
	updateHookOverride,
} from "@/src/lib/api/hooks.ts";
import {
	GovernanceScopeSwitcher,
	type GovernanceView,
} from "./GovernanceScopeSwitcher.tsx";
import { groupHookInventory, type HookPhaseGroup } from "./hooks-view.ts";

const hooksQueryKey = (target: ApiTarget) => [
	"hook-management",
	target.url,
	target.token,
];

const governanceQueryKey = (target: ApiTarget) => [
	"gateway-governance",
	target.url,
	target.token,
];

const localWriteScope = (
	view: GovernanceView
): Extract<GovernanceScope, "node" | "user"> | null => {
	switch (view) {
		case "effective":
		case "user":
			return "user";
		case "node":
			return "node";
		case "organization":
		case "team":
			return null;
	}
};

function HookMetadata({ hook }: { hook: HookInventoryItem }) {
	return (
		<dl className="grid gap-x-4 gap-y-2 rounded-xl border border-border/70 bg-background/65 px-4 py-3 text-xs sm:grid-cols-[100px_minmax(0,1fr)]">
			<dt className="text-muted-foreground">Handler</dt>
			<dd>{hook.handler.display}</dd>
			{hook.handler.path ? (
				<>
					<dt className="text-muted-foreground">Source</dt>
					<dd className="break-all font-mono">{hook.handler.path}</dd>
				</>
			) : null}
			<dt className="text-muted-foreground">Matcher</dt>
			<dd className="break-words font-mono">
				{hook.matcher ? JSON.stringify(hook.matcher) : "All matching events"}
			</dd>
			<dt className="text-muted-foreground">Priority</dt>
			<dd className="font-mono tabular-nums">{hook.priority}</dd>
			<dt className="text-muted-foreground">Hook ID</dt>
			<dd className="break-all font-mono">{hook.id}</dd>
		</dl>
	);
}

function HookRow({
	canConfigure,
	hook,
	onUpdate,
	pending,
	view,
}: {
	canConfigure: boolean;
	hook: HookInventoryItem;
	onUpdate: (
		hook: HookInventoryItem,
		policy: HookPolicyOverride
	) => Promise<void>;
	pending: boolean;
	view: GovernanceView;
}) {
	const [open, setOpen] = useState(false);
	const scope = localWriteScope(view);
	const localPolicy = scope ? hook.localOverrides[scope] : undefined;
	const enabled = localPolicy?.enabled ?? hook.enabled;
	const trusted = localPolicy?.trusted ?? hook.trusted;
	const canWrite =
		scope !== null && hook.pluginEnabled && (scope === "user" || canConfigure);
	const inherited =
		view !== "effective" &&
		((localPolicy?.enabled === undefined &&
			localPolicy?.trusted === undefined) ||
			scope === null);

	return (
		<Collapsible onOpenChange={setOpen} open={open}>
			<div className="border-border/65 border-b px-3 py-2.5 last:border-b-0">
				<div className="flex min-w-0 items-center gap-2">
					<CollapsibleTrigger
						aria-label={`${open ? "Hide" : "Show"} details for ${hook.id}`}
						className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<span className="min-w-0 flex-1 truncate font-medium text-sm">
							{hook.id}
						</span>
						{inherited ? (
							<span className="text-[11px] text-muted-foreground">
								Inherited
							</span>
						) : null}
						<HugeiconsIcon
							aria-hidden
							className={cn(
								"size-3.5 shrink-0 text-muted-foreground transition-transform",
								open && "rotate-180"
							)}
							icon={ArrowDown01Icon}
						/>
					</CollapsibleTrigger>
					<Button
						aria-label={`${trusted ? "Remove trust from" : "Trust"} ${hook.id}`}
						disabled={!canWrite || pending}
						onClick={() =>
							onUpdate(hook, {
								...localPolicy,
								trusted: !trusted,
							})
						}
						size="sm"
						variant={trusted ? "secondary" : "outline"}
					>
						<HugeiconsIcon className="size-3.5" icon={Shield01Icon} />
						{trusted ? "Trusted" : "Trust"}
					</Button>
					<Switch
						aria-label={`${enabled ? "Disable" : "Enable"} ${hook.id}`}
						checked={enabled}
						disabled={!canWrite || pending || !trusted}
						onCheckedChange={(checked) =>
							onUpdate(hook, { ...localPolicy, enabled: checked })
						}
					/>
				</div>
				{hook.pluginEnabled ? null : (
					<p className="mt-1 text-muted-foreground text-xs">
						Enable {hook.ownerName} before this hook can run.
					</p>
				)}
				<CollapsibleContent className="pt-2">
					<HookMetadata hook={hook} />
				</CollapsibleContent>
			</div>
		</Collapsible>
	);
}

function HookPhase({
	canConfigure,
	onUpdate,
	pendingKey,
	phase,
	view,
}: {
	canConfigure: boolean;
	onUpdate: (
		hook: HookInventoryItem,
		policy: HookPolicyOverride
	) => Promise<void>;
	pendingKey: string | null;
	phase: HookPhaseGroup;
	view: GovernanceView;
}) {
	return (
		<section>
			<div className="flex items-center gap-3 border-border/65 border-b bg-muted/15 px-4 py-3">
				<HugeiconsIcon className="size-4 shrink-0" icon={CodeCircleIcon} />
				<div className="min-w-0 flex-1">
					<h4 className="font-medium text-sm">{phase.title}</h4>
					<p className="text-muted-foreground text-xs">{phase.description}</p>
				</div>
				{phase.hooks.some((hook) => hook.reviewRequired) ? (
					<HugeiconsIcon className="size-4 text-warning" icon={Alert02Icon} />
				) : null}
			</div>
			{phase.hooks.map((hook) => (
				<HookRow
					canConfigure={canConfigure}
					hook={hook}
					key={hook.hookKey}
					onUpdate={onUpdate}
					pending={pendingKey === hook.hookKey}
					view={view}
				/>
			))}
		</section>
	);
}

export function HooksSection({
	canConfigure,
	target,
}: {
	canConfigure: boolean;
	target: ApiTarget;
}) {
	const queryClient = useQueryClient();
	const [view, setView] = useState<GovernanceView>("effective");
	const [pendingKey, setPendingKey] = useState<string | null>(null);
	const hooksQuery = useQuery({
		queryKey: hooksQueryKey(target),
		queryFn: ({ signal }) => fetchHookInventory(target, signal),
		refetchInterval: 30_000,
	});
	const governanceQuery = useQuery({
		queryKey: governanceQueryKey(target),
		queryFn: ({ signal }) => fetchGatewayGovernance(target, signal),
	});
	const groups = groupHookInventory(hooksQuery.data?.hooks ?? []);

	const updatePolicy = async (
		hook: HookInventoryItem,
		policy: HookPolicyOverride
	) => {
		const scope = localWriteScope(view);
		if (!scope) {
			return;
		}
		setPendingKey(hook.hookKey);
		try {
			const inventory = await updateHookOverride(target, {
				hookKey: hook.hookKey,
				policy,
				scope,
			});
			queryClient.setQueryData<HookInventory>(hooksQueryKey(target), inventory);
		} finally {
			setPendingKey(null);
		}
	};

	return (
		<div className="space-y-6">
			<SettingsSection
				caption="Review lifecycle automation from your configuration and installed plugins. Trust and enablement are enforced by Core before a hook can run."
				headerAction={
					<Button
						aria-label="Refresh hooks"
						disabled={hooksQuery.isFetching}
						onClick={() => hooksQuery.refetch()}
						size="icon"
						variant="ghost"
					>
						<HugeiconsIcon
							className={cn("size-4", hooksQuery.isFetching && "animate-spin")}
							icon={Refresh01Icon}
						/>
					</Button>
				}
				title="Hooks"
			>
				<div className="space-y-4 px-3">
					<GovernanceScopeSwitcher
						layers={governanceQuery.data?.layers ?? []}
						onValueChange={setView}
						value={view}
					/>
					<div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
						<HugeiconsIcon
							className="mt-0.5 size-4 shrink-0 text-warning"
							icon={Alert02Icon}
						/>
						<p>
							Hooks can act at lifecycle boundaries. Review newly installed or
							changed hooks before trusting them.
						</p>
					</div>
				</div>
			</SettingsSection>

			{hooksQuery.isLoading ? (
				<div className="flex items-center justify-center py-12">
					<Spinner className="size-5" />
				</div>
			) : null}
			{hooksQuery.error ? (
				<p className="px-3 text-destructive text-sm">
					{hooksQuery.error instanceof Error
						? hooksQuery.error.message
						: "Hooks could not be loaded."}
				</p>
			) : null}
			{!(hooksQuery.isLoading || hooksQuery.error) && groups.length === 0 ? (
				<div className="rounded-2xl border border-dashed px-6 py-10 text-center">
					<p className="font-medium text-sm">No hooks installed</p>
					<p className="mt-1 text-muted-foreground text-xs">
						Hooks from configuration and enabled plugins will appear here.
					</p>
				</div>
			) : null}

			{groups.map((group) => (
				<section className="space-y-3" key={group.source}>
					<h3 className="px-1 font-medium text-sm">{group.label}</h3>
					{group.owners.map((owner) => (
						<div
							className="overflow-hidden rounded-2xl border border-border/80 bg-card/45"
							key={owner.ownerId}
						>
							<div className="flex items-center gap-3 border-border/65 border-b px-4 py-3.5">
								<div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/70">
									<HugeiconsIcon className="size-4" icon={CodeCircleIcon} />
								</div>
								<div className="min-w-0 flex-1">
									<p className="truncate font-medium">{owner.ownerName}</p>
									<p className="text-muted-foreground text-xs">
										{owner.hookCount} hook{owner.hookCount === 1 ? "" : "s"}
									</p>
								</div>
								{owner.reviewCount > 0 ? (
									<Badge className="gap-1" variant="outline">
										<HugeiconsIcon
											className="size-3.5 text-warning"
											icon={Alert02Icon}
										/>
										{owner.reviewCount} need{owner.reviewCount === 1 ? "s" : ""}{" "}
										review
									</Badge>
								) : (
									<Badge variant="secondary">Reviewed</Badge>
								)}
							</div>
							{owner.phases.map((phase) => (
								<HookPhase
									canConfigure={canConfigure}
									key={phase.phase}
									onUpdate={updatePolicy}
									pendingKey={pendingKey}
									phase={phase}
									view={view}
								/>
							))}
						</div>
					))}
				</section>
			))}
		</div>
	);
}
