// apps/desktop/src/components/settings/AgentModelsSettings.tsx
//
// Per-model visibility for AGENTS, the third column of the model-toggle surface
// (Ryu providers · BYO-key providers · agents). An external agent — Claude Code,
// Codex, Gemini CLI — is not a Pi provider: it has no credential, no base URL and
// no routing, and it advertises its OWN model list over ACP. So it gets none of
// `ProviderCard`'s controls; the one thing it shares is the on/off switch per
// model, which is exactly what a user wants when an agent lists a dozen models
// and they use two.
//
// The toggles persist through the SAME `POST /api/pi-config/model-enabled`
// writer the providers use, under Core's reserved `agent:<id>` scope
// (`agentModelScope`). Core keeps those scopes out of the provider catalog and
// republishes them as `catalog.agentModelOverrides`, so nothing here needs a
// store of its own and every picker filters on one already-loaded catalog.
//
// Model lists are fetched lazily, on expand: `GET /acp-config` SPAWNS the agent's
// subprocess on first call (up to ~30s), so probing every installed agent when
// this tab merely renders would be a fleet of cold starts nobody asked for.

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@ryu/ui/components/collapsible";
import { Label } from "@ryu/ui/components/label";
import { Spinner } from "@ryu/ui/components/spinner";
import { Switch } from "@ryu/ui/components/switch";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { sileo } from "sileo";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { AgentLogo, engineForAgent } from "@/src/lib/agent-logos.tsx";
import { fetchAcpConfig, flattenConfigOptions } from "@/src/lib/api/acp.ts";
import type { AgentSummary } from "@/src/lib/api/agents.ts";
import { fetchAgents } from "@/src/lib/api/agents.ts";
import { agentModelScope } from "@/src/lib/api/pi-config.ts";
import { SettingsCard, SettingsSection } from "./shared/settings-items.tsx";

/** The flagship agent id (mirrors Core `DEFAULT_AGENT_ID`). */
const RYU_AGENT_ID = "ryu";

interface AgentModel {
	id: string;
	name: string;
}

function errMessage(e: unknown, fallback: string): string {
	return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * One agent's models with a switch each. Expanding probes the agent's advertised
 * config; a model is visible in every picker unless its switch is off.
 */
function AgentCard({
	agent,
	overrides,
	onToggleModel,
}: {
	agent: AgentSummary;
	onToggleModel: (
		provider: string,
		model: string,
		enabled: boolean
	) => Promise<unknown>;
	overrides: Record<string, boolean> | undefined;
}) {
	const node = useActiveNode();
	const [open, setOpen] = useState(false);
	const [toggling, setToggling] = useState<string | null>(null);

	const configQuery = useQuery({
		queryKey: ["acp-config", node.url, agent.id],
		queryFn: () =>
			fetchAcpConfig({ url: node.url, token: node.token ?? null }, agent.id),
		// Cold-start cost is the whole reason this is gated on `open`.
		enabled: open,
		staleTime: 5 * 60 * 1000,
		refetchOnWindowFocus: false,
	});

	// The agent's models, from whichever surface it advertises them on: the
	// dedicated ACP `models` capability, or a `category: "model"` config option.
	// Same priority order the composer's picker resolves, so what is toggleable
	// here is exactly what is offered there.
	const models = useMemo<AgentModel[]>(() => {
		const config = configQuery.data;
		const advertised = config?.models?.availableModels ?? [];
		if (advertised.length > 0) {
			return advertised.map((m) => ({ id: m.modelId, name: m.name }));
		}
		const option = (config?.configOptions ?? []).find(
			(opt) => opt.category === "model"
		);
		if (option) {
			return flattenConfigOptions(option).map((o) => ({
				id: o.value,
				name: o.name,
			}));
		}
		return [];
	}, [configQuery.data]);

	const hiddenCount = models.filter((m) => overrides?.[m.id] === false).length;

	const handleToggle = async (modelId: string, enabled: boolean) => {
		setToggling(modelId);
		try {
			await onToggleModel(agentModelScope(agent.id), modelId, enabled);
		} catch (e) {
			sileo.error({
				title: "Could not update model",
				description: errMessage(e, "Core rejected the request."),
			});
		} finally {
			setToggling(null);
		}
	};

	return (
		<SettingsCard className="p-0">
			<Collapsible onOpenChange={setOpen} open={open}>
				<CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-[10px] p-3.5 text-left hover:bg-muted/40">
					<div className="flex min-w-0 items-center gap-2.5">
						<AgentLogo
							className="size-4 shrink-0"
							engine={engineForAgent(agent)}
						/>
						<div className="flex min-w-0 flex-col gap-1">
							<span className="font-medium text-sm">{agent.name}</span>
							<span className="text-muted-foreground text-xs">
								{hiddenCount > 0
									? `${hiddenCount} model${hiddenCount === 1 ? "" : "s"} hidden`
									: "All models visible"}
							</span>
						</div>
					</div>
					<HugeiconsIcon
						className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
						icon={ArrowDown01Icon}
					/>
				</CollapsibleTrigger>

				<CollapsibleContent className="flex flex-col gap-2 px-3.5 pt-1 pb-3.5">
					{configQuery.isPending ? (
						<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
							<Spinner className="size-3" /> Asking {agent.name} what it offers…
						</span>
					) : null}
					{!configQuery.isPending && configQuery.isError ? (
						<span className="text-destructive text-xs">
							Could not read this agent's models:{" "}
							{errMessage(configQuery.error, "the agent did not respond.")}
						</span>
					) : null}
					{!(configQuery.isPending || configQuery.isError) &&
					models.length === 0 ? (
						<span className="text-muted-foreground text-xs">
							This agent advertises no model list of its own. It picks models
							itself, so there is nothing to hide here.
						</span>
					) : null}
					{models.length > 0 ? (
						<div className="flex flex-col gap-1.5">
							<Label>Visible models</Label>
							<div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-md border border-border/60 p-1.5">
								{models.map((m) => (
									<div
										className="flex items-center justify-between gap-2 px-1.5 py-1"
										key={m.id}
									>
										<span className="min-w-0 truncate text-xs">{m.name}</span>
										<Switch
											// Absent from the overrides map ⇒ visible.
											checked={overrides?.[m.id] !== false}
											disabled={toggling === m.id}
											onCheckedChange={(next) => handleToggle(m.id, next)}
										/>
									</div>
								))}
							</div>
						</div>
					) : null}
				</CollapsibleContent>
			</Collapsible>
		</SettingsCard>
	);
}

export function AgentModelsSettings({
	agentModelOverrides,
	onToggleModel,
}: {
	agentModelOverrides: Record<string, Record<string, boolean>> | undefined;
	onToggleModel: (
		provider: string,
		model: string,
		enabled: boolean
	) => Promise<unknown>;
}) {
	const node = useActiveNode();
	const agentsQuery = useQuery({
		queryKey: ["agents", node.url],
		queryFn: () => fetchAgents({ url: node.url, token: node.token ?? null }),
		staleTime: 60_000,
	});

	// The flagship is deliberately absent. Ryu's models ARE the provider models the
	// cards above own, so a Ryu row here would be a SECOND switch for the same
	// model writing to a different scope (`agent:ryu` instead of the provider) —
	// two controls that disagree, where turning a model off in one leaves it
	// showing as on in the other.
	const agents = (agentsQuery.data ?? []).filter((a) => a.id !== RYU_AGENT_ID);

	return (
		<SettingsSection
			caption="Hide the models you never use from an agent's picker. External agents report their own model lists, so these switches are separate from the provider lists above, and the agent still keeps every model it was going to pick for itself. Ryu's own models are the provider models above."
			title="Agent models"
		>
			{agentsQuery.isPending ? (
				<div className="flex items-center gap-2 text-muted-foreground text-sm">
					<Spinner className="size-4" /> Loading agents…
				</div>
			) : null}
			{agents.length === 0 && !agentsQuery.isPending ? (
				<p className="text-muted-foreground text-sm">No agents installed.</p>
			) : null}
			<div className="space-y-2.5">
				{agents.map((agent) => (
					<AgentCard
						agent={agent}
						key={agent.id}
						onToggleModel={onToggleModel}
						overrides={agentModelOverrides?.[agent.id]}
					/>
				))}
			</div>
		</SettingsSection>
	);
}
