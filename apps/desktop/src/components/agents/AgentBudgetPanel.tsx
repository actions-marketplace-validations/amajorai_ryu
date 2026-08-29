import { Delete01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@ryu/ui/components/badge.tsx";
import { Button } from "@ryu/ui/components/button.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BudgetRuleFields } from "@/src/components/gateway/BudgetRuleFields.tsx";
import {
	ACTION_LABELS,
	type BudgetFormState,
	budgetFormToRule,
	budgetRuleToForm,
	budgetUsdToMicroUsd,
	formatBudgetUsd,
} from "@/src/components/gateway/budget-copy.ts";
import {
	SettingsCard,
	SettingsSection,
} from "@/src/components/settings/shared/settings-items.tsx";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { useGatewayConfigurable } from "@/src/hooks/useGatewayConfigurable.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	type BudgetRule,
	type BudgetSpend,
	fetchBudgetSpend,
	fetchGatewayConfig,
	updateGatewayConfig,
	withAgentBudget,
} from "@/src/lib/api/gateway.ts";

const SPEND_POLL_MS = 5000;

export function AgentBudgetPanel({
	agentId,
	disabled = false,
}: {
	agentId: string;
	disabled?: boolean;
}) {
	const node = useActiveNode();
	const target = useMemo(
		() => toTarget(node),
		[node.token, node.url, node.userJwt]
	);
	const canConfigure = useGatewayConfigurable();
	const [rule, setRule] = useState<BudgetRule | null>(null);
	const [form, setForm] = useState<BudgetFormState>(() =>
		budgetRuleToForm(agentId)
	);
	const [spend, setSpend] = useState<BudgetSpend | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	const loadConfig = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const config = await fetchGatewayConfig(target);
			const nextRule = config.budgets.agents[agentId] ?? null;
			setRule(nextRule);
			setForm(budgetRuleToForm(agentId, nextRule));
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Gateway budget configuration is unavailable."
			);
		} finally {
			setLoading(false);
		}
	}, [agentId, target]);

	const loadSpend = useCallback(async () => {
		try {
			setSpend(await fetchBudgetSpend(target, { agentId }));
		} catch {
			// The configuration error above owns the actionable state. Spend is a
			// secondary readout and may be unavailable while the Gateway starts.
		}
	}, [agentId, target]);

	useEffect(() => {
		loadConfig().catch(() => undefined);
	}, [loadConfig]);

	useEffect(() => {
		loadSpend().catch(() => undefined);
		const timer = setInterval(() => {
			loadSpend().catch(() => undefined);
		}, SPEND_POLL_MS);
		return () => clearInterval(timer);
	}, [loadSpend]);

	const handleSave = async () => {
		if (budgetUsdToMicroUsd(form.limitUsd) === null) {
			setError(
				"Spend cap must be a non-negative USD amount (up to 6 decimals)."
			);
			return;
		}
		setSaving(true);
		setSaved(false);
		setError(null);
		try {
			const config = await fetchGatewayConfig(target);
			const nextRule = budgetFormToRule(form);
			await updateGatewayConfig(target, {
				budgets: withAgentBudget(config.budgets, agentId, nextRule),
			});
			setRule(nextRule);
			setForm(budgetRuleToForm(agentId, nextRule));
			setSaved(true);
			await loadSpend();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Failed to save agent budget."
			);
		} finally {
			setSaving(false);
		}
	};

	const handleRemove = async () => {
		if (!rule) {
			return;
		}
		setSaving(true);
		setSaved(false);
		setError(null);
		try {
			const config = await fetchGatewayConfig(target);
			await updateGatewayConfig(target, {
				budgets: withAgentBudget(config.budgets, agentId, null),
			});
			setRule(null);
			setForm(budgetRuleToForm(agentId));
			setSpend(null);
			setSaved(true);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Failed to remove agent budget."
			);
		} finally {
			setSaving(false);
		}
	};

	const readOnly = disabled || !canConfigure;
	const spent = spend?.agents[agentId] ?? 0;
	const configuredLimit = spend?.limits.agents[agentId] ?? rule?.limit ?? 0;

	return (
		<SettingsSection
			caption="Set this agent's lifetime charged-spend cap and choose whether model, media, or paid-tool charges count. The Gateway Budgets view remains available for managing every user and agent rule together."
			title="Budget"
		>
			{loading ? (
				<div className="flex items-center gap-2 text-muted-foreground text-sm">
					<Spinner className="size-4" />
					Loading budget…
				</div>
			) : (
				<SettingsCard className="flex flex-col gap-4">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p className="font-medium text-sm">This agent's Gateway budget</p>
							<p className="text-muted-foreground text-xs">
								{rule
									? `${formatBudgetUsd(rule.limit)} spend cap · ${ACTION_LABELS[rule.action]}`
									: "No cap configured yet."}
							</p>
						</div>
						{spend?.reachable && rule ? (
							<Badge variant="secondary">
								Live spend: {formatBudgetUsd(spent)}
								{configuredLimit > 0
									? ` / ${formatBudgetUsd(configuredLimit)}`
									: ""}{" "}
							</Badge>
						) : null}
					</div>

					<BudgetRuleFields
						disabled={readOnly || saving}
						form={form}
						idPrefix="agent-budget"
						onChange={setForm}
						target={target}
					/>

					<div className="flex flex-wrap items-center justify-end gap-2">
						{rule ? (
							<Button
								disabled={readOnly || saving}
								onClick={() => handleRemove()}
								type="button"
								variant="ghost"
							>
								<HugeiconsIcon className="size-4" icon={Delete01Icon} />
								Remove cap
							</Button>
						) : null}
						<Button
							disabled={readOnly || saving}
							loading={saving}
							onClick={() => handleSave()}
							type="button"
						>
							Save budget
						</Button>
					</div>

					{canConfigure ? null : (
						<p className="text-muted-foreground text-xs">
							You need the <span className="font-mono">gateway.configure</span>{" "}
							permission to change this rule.
						</p>
					)}
					{error ? <p className="text-destructive text-sm">{error}</p> : null}
					{saved ? (
						<p className="text-muted-foreground text-xs">
							Budget updated. Changes take effect immediately.
						</p>
					) : null}
				</SettingsCard>
			)}
		</SettingsSection>
	);
}
