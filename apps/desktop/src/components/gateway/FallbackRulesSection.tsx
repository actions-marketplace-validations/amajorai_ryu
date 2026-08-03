// The node's threshold model fallback rules — "when I'm nearly out of X, run Y
// instead, and tell me you did it".
//
// Lives in the Gateway (node) settings dialog next to the other routing cards,
// NOT in an apps-store app's own settings tab. An app-registered tab inherits
// the app's enablement, so disabling the app would either keep rewriting turns
// with no UI left to explain why, or quietly stop enforcing rules the user still
// believes are on. Both are silent loss of control over which model answers.
// Kernel-owned with an empty default rule list is exactly today's behaviour
// until somebody writes a rule.
//
// The three sources are NOT interchangeable and the form says so, because they
// do not report the same kind of number:
//
//   Ryu credit        -> dollars left in the org's prepaid wallet
//   Provider credit   -> dollars left on a BYO key (only the few vendors that
//                        expose a balance to an inference key)
//   Subscription      -> percent left of a rolling rate-limit window
//
// Picking the source swaps the threshold field with it, so "Claude subscription
// below $5" — a rule that could never evaluate — is unrepresentable here rather
// than merely discouraged.

import {
	Add01Icon,
	ArrowDown01Icon,
	ArrowUp01Icon,
	Delete01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button";
import { Input } from "@ryu/ui/components/input";
import { Label } from "@ryu/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select";
import { Spinner } from "@ryu/ui/components/spinner";
import { Switch } from "@ryu/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { sileo } from "sileo";
import { AgentSelectionField } from "@/components/agent-elements/input/agent-selection-field.tsx";
import {
	SettingsCard,
	SettingsSection,
} from "@/src/components/settings/shared/settings-items.tsx";
import { useAgents } from "@/src/hooks/useAgents.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import { EMPTY_AGENT_SELECTION } from "@/src/lib/api/preferences.ts";
import type {
	RoutingCondition,
	RoutingPolicy,
	RoutingPolicyView,
	RoutingRule,
} from "@/src/lib/api/routing.ts";
import {
	fetchRoutingPolicy,
	saveRoutingPolicy,
} from "@/src/lib/api/routing.ts";
import { supportsUsage } from "@/src/lib/api/usage.ts";

/** A blank rule, defaulted to the case people reach for first. */
function newRule(id: string): RoutingRule {
	return {
		id,
		enabled: true,
		when: { source: "ryu_credits", below_usd: 5 },
		// Copied, not shared: `EMPTY_AGENT_SELECTION` is a module constant, and
		// handing every new rule the same object is one careless in-place edit away
		// from rewriting every rule's default.
		fallback: { ...EMPTY_AGENT_SELECTION },
		applies_to_agents: [],
		notify: true,
	};
}

/** Swap the condition's source, seeding sensible defaults for the new unit. */
function conditionForSource(
	source: RoutingCondition["source"],
	agentId: string,
	creditProviders: string[]
): RoutingCondition {
	if (source === "ryu_credits") {
		return { source, below_usd: 5 };
	}
	if (source === "provider_credits") {
		return { source, provider_id: creditProviders[0] ?? "", below_usd: 5 };
	}
	return {
		source,
		agent_id: agentId,
		window: "",
		remaining_below_percent: 50,
	};
}

// Option lists live next to the form, not inline in the dropdown, because the
// closed trigger resolves its text through the Select's `items` prop: split the
// two and the trigger goes back to printing "subscription_window".
//
// "any" is the stored empty string — "whichever window is most consumed" is the
// honest default, since vendors name and count their windows differently and a
// rule matching nothing looks broken.
const WINDOW_OPTIONS: { value: string; label: string }[] = [
	{ value: "any", label: "Whichever bites first" },
	{ value: "session", label: "Session (5h)" },
	{ value: "weekly", label: "Weekly" },
];

const SOURCE_OPTIONS: { value: RoutingCondition["source"]; label: string }[] = [
	{ value: "ryu_credits", label: "Ryu credit runs low" },
	{ value: "provider_credits", label: "A provider key's credit runs low" },
	{ value: "subscription_window", label: "A subscription window runs low" },
];

function sourceLabel(source: RoutingCondition["source"]): string {
	if (source === "ryu_credits") {
		return "Ryu credit";
	}
	if (source === "provider_credits") {
		return "Provider credit";
	}
	return "Subscription window";
}

/** The threshold + its qualifiers, which differ per source. */
function ConditionFields({
	condition,
	creditProviders,
	disabled,
	onChange,
	subscriptionAgents,
}: {
	condition: RoutingCondition;
	creditProviders: string[];
	disabled: boolean;
	onChange: (next: RoutingCondition) => void;
	subscriptionAgents: string[];
}) {
	if (condition.source === "ryu_credits") {
		return (
			<div className="flex items-end gap-2">
				<div className="space-y-1">
					<Label className="text-xs" htmlFor="ryu-credit-threshold">
						Dollars left, below
					</Label>
					<Input
						className="h-8 w-28"
						disabled={disabled}
						id="ryu-credit-threshold"
						inputMode="decimal"
						onChange={(e) =>
							onChange({
								...condition,
								below_usd: Number(e.target.value) || 0,
							})
						}
						value={condition.below_usd}
					/>
				</div>
			</div>
		);
	}

	if (condition.source === "provider_credits") {
		return (
			<div className="flex items-end gap-2">
				<div className="space-y-1">
					<Label className="text-xs">Provider</Label>
					<Select
						disabled={disabled}
						items={creditProviders.map((id) => ({ label: id, value: id }))}
						onValueChange={(provider_id) =>
							onChange({ ...condition, provider_id: provider_id ?? "" })
						}
						value={condition.provider_id}
					>
						<SelectTrigger className="h-8 w-40">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{creditProviders.map((id) => (
								<SelectItem key={id} value={id}>
									{id}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1">
					<Label className="text-xs" htmlFor="provider-credit-threshold">
						Dollars left, below
					</Label>
					<Input
						className="h-8 w-28"
						disabled={disabled}
						id="provider-credit-threshold"
						inputMode="decimal"
						onChange={(e) =>
							onChange({
								...condition,
								below_usd: Number(e.target.value) || 0,
							})
						}
						value={condition.below_usd}
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-wrap items-end gap-2">
			<div className="space-y-1">
				<Label className="text-xs">Agent</Label>
				<Select
					disabled={disabled}
					items={subscriptionAgents.map((id) => ({ label: id, value: id }))}
					onValueChange={(agent_id) =>
						onChange({ ...condition, agent_id: agent_id ?? "" })
					}
					value={condition.agent_id}
				>
					<SelectTrigger className="h-8 w-44">
						<SelectValue placeholder="Pick an agent" />
					</SelectTrigger>
					<SelectContent>
						{subscriptionAgents.map((id) => (
							<SelectItem key={id} value={id}>
								{id}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="space-y-1">
				<Label className="text-xs">Window</Label>
				<Select
					disabled={disabled}
					items={WINDOW_OPTIONS}
					onValueChange={(window) =>
						onChange({
							...condition,
							window: !window || window === "any" ? "" : window,
						})
					}
					value={condition.window === "" ? "any" : condition.window}
				>
					<SelectTrigger className="h-8 w-40">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{WINDOW_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="space-y-1">
				<Label className="text-xs" htmlFor="window-threshold">
					Percent left, below
				</Label>
				<Input
					className="h-8 w-28"
					disabled={disabled}
					id="window-threshold"
					inputMode="numeric"
					onChange={(e) =>
						onChange({
							...condition,
							remaining_below_percent: Number(e.target.value) || 0,
						})
					}
					value={condition.remaining_below_percent}
				/>
			</div>
		</div>
	);
}

function RuleCard({
	canConfigure,
	creditProviders,
	index,
	onChange,
	onMove,
	onRemove,
	rule,
	subscriptionAgents,
	target,
	total,
}: {
	canConfigure: boolean;
	creditProviders: string[];
	index: number;
	onChange: (next: RoutingRule) => void;
	onMove: (delta: number) => void;
	onRemove: () => void;
	rule: RoutingRule;
	subscriptionAgents: string[];
	target: ApiTarget;
	total: number;
}) {
	const disabled = !canConfigure;
	return (
		<SettingsCard className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Switch
						aria-label="Rule enabled"
						checked={rule.enabled}
						disabled={disabled}
						onCheckedChange={(enabled) => onChange({ ...rule, enabled })}
					/>
					<span className="font-medium text-sm">
						{sourceLabel(rule.when.source)}
					</span>
				</div>
				<div className="flex items-center gap-1">
					<Button
						aria-label="Move rule up"
						disabled={disabled || index === 0}
						onClick={() => onMove(-1)}
						size="icon"
						variant="ghost"
					>
						<HugeiconsIcon icon={ArrowUp01Icon} size={16} />
					</Button>
					<Button
						aria-label="Move rule down"
						disabled={disabled || index === total - 1}
						onClick={() => onMove(1)}
						size="icon"
						variant="ghost"
					>
						<HugeiconsIcon icon={ArrowDown01Icon} size={16} />
					</Button>
					<Button
						aria-label="Delete rule"
						disabled={disabled}
						onClick={onRemove}
						size="icon"
						variant="ghost"
					>
						<HugeiconsIcon icon={Delete01Icon} size={16} />
					</Button>
				</div>
			</div>

			<div className="space-y-1">
				<Label className="text-xs">When</Label>
				<Select
					disabled={disabled}
					items={SOURCE_OPTIONS}
					onValueChange={(source) =>
						onChange({
							...rule,
							when: conditionForSource(
								(source ?? "ryu_credits") as RoutingCondition["source"],
								subscriptionAgents[0] ?? "",
								creditProviders
							),
						})
					}
					value={rule.when.source}
				>
					<SelectTrigger className="h-8 w-56">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{SOURCE_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<ConditionFields
				condition={rule.when}
				creditProviders={creditProviders}
				disabled={disabled}
				onChange={(when) => onChange({ ...rule, when })}
				subscriptionAgents={subscriptionAgents}
			/>

			<div className="space-y-1">
				<Label className="text-xs">Then run</Label>
				<AgentSelectionField
					ariaLabel="Fallback agent or model"
					disabled={disabled}
					onChange={(fallback) => onChange({ ...rule, fallback })}
					placeholder="Just warn me — don't change the model"
					target={target}
					value={rule.fallback}
				/>
			</div>

			<div className="flex items-center justify-between gap-3">
				<span className="text-muted-foreground text-xs">
					Show a notice above the composer when this fires
				</span>
				<Switch
					aria-label="Notify when this rule fires"
					checked={rule.notify}
					disabled={disabled}
					onCheckedChange={(notify) => onChange({ ...rule, notify })}
				/>
			</div>
		</SettingsCard>
	);
}

/**
 * The rules card for the Gateway dialog's "Model routing" section.
 *
 * Order is meaningful and preserved verbatim: Core stops at the FIRST rule that
 * fires, so the arrows are the user's priority statement, not decoration.
 */
export function FallbackRulesSection({
	canConfigure,
	target,
}: {
	canConfigure: boolean;
	target: ApiTarget;
}) {
	const queryClient = useQueryClient();
	const { agents } = useAgents();
	// Only agents whose subscription windows Core can actually read can back a
	// percent rule — the same gate the usage bar uses, so the two never disagree
	// about which agents have a readable plan.
	const subscriptionAgents = agents
		.map((a) => a.id)
		.filter((id) => supportsUsage(id));

	const policyQuery = useQuery({
		queryKey: ["routing-policy", target.url],
		queryFn: () => fetchRoutingPolicy(target),
		refetchOnWindowFocus: false,
	});

	const save = useMutation({
		mutationFn: (policy: RoutingPolicy) => saveRoutingPolicy(target, policy),
		onSuccess: (_data, policy) => {
			// Merge, don't replace: the cached value also carries `credit_providers`
			// (served by Core, not something a save round-trips), and overwriting it
			// with the bare policy would empty the provider dropdown until refetch.
			queryClient.setQueryData<RoutingPolicyView>(
				["routing-policy", target.url],
				(prev) =>
					prev
						? { ...prev, rules: policy.rules }
						: { rules: policy.rules, credit_providers: [] }
			);
			// The verdict the composer shows is derived from these rules, so a save
			// has to drop it or the bar keeps describing the old configuration.
			queryClient.invalidateQueries({ queryKey: ["routing-advice"] });
		},
		onError: (error: Error) => {
			sileo.error({
				title: "Could not save fallback rules",
				description: error.message,
			});
		},
	});

	const rules = policyQuery.data?.rules ?? [];
	// Which providers a credit rule may name — served by Core, which owns the
	// balance readers, so this form can never offer a provider whose balance
	// cannot actually be read.
	const creditProviders = policyQuery.data?.credit_providers ?? [];
	const commit = useCallback(
		(next: RoutingRule[]) => save.mutate({ rules: next }),
		[save]
	);

	const addRule = () => {
		// A rule id only has to be stable and unique within the list; it is what
		// the composer notice cites and what the reorder keys off.
		const id = `rule-${Date.now().toString(36)}`;
		commit([...rules, newRule(id)]);
	};

	return (
		<SettingsSection
			caption="Checked before every turn, against cached balances — the first rule that matches wins, so order these from most specific to most general."
			headerAction={
				<Button
					disabled={!canConfigure || save.isPending}
					onClick={addRule}
					size="sm"
					variant="ghost"
				>
					<HugeiconsIcon icon={Add01Icon} size={16} />
					Add rule
				</Button>
			}
			title="Fallback when you're running low"
		>
			{policyQuery.isLoading ? (
				<SettingsCard>
					<Spinner />
				</SettingsCard>
			) : null}
			{!policyQuery.isLoading && rules.length === 0 ? (
				<SettingsCard>
					<p className="text-muted-foreground text-sm">
						No rules yet. Add one to drop to a cheaper model when your Ryu
						credit, a provider key's balance, or a subscription window runs low
						— instead of finding out when a turn fails.
					</p>
				</SettingsCard>
			) : null}
			<div className="space-y-2">
				{rules.map((rule, index) => (
					<RuleCard
						canConfigure={canConfigure && !save.isPending}
						creditProviders={creditProviders}
						index={index}
						key={rule.id}
						onChange={(next) =>
							commit(rules.map((r) => (r.id === rule.id ? next : r)))
						}
						onMove={(delta) => {
							const to = index + delta;
							if (to < 0 || to >= rules.length) {
								return;
							}
							const next = [...rules];
							const [moved] = next.splice(index, 1);
							next.splice(to, 0, moved);
							commit(next);
						}}
						onRemove={() => commit(rules.filter((r) => r.id !== rule.id))}
						rule={rule}
						subscriptionAgents={subscriptionAgents}
						target={target}
						total={rules.length}
					/>
				))}
			</div>
		</SettingsSection>
	);
}
