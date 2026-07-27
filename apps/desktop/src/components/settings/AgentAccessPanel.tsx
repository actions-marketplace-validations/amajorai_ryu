// apps/desktop/src/components/settings/AgentAccessPanel.tsx
//
// Inline "what this agent can reach" editor for settings pages that pick an
// agent (Dictation agent-ask, and reusable elsewhere). Cross-app access is the
// chosen agent's allowlists — Spaces for retrieval, MCP tools grouped by the
// owning app/plugin (ghost__, spaces__, browser__, …). Editing here is the same
// data as Agent edit → Tools / Memory & Spaces; this panel is the compact surface
// for feature settings that need cross-allow without leaving the page.

import { Checkbox } from "@ryu/ui/components/checkbox";
import { Label } from "@ryu/ui/components/label";
import { toast } from "@ryu/ui/components/sileo";
import { Switch } from "@ryu/ui/components/switch";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	type Agent,
	type AgentInput,
	fetchAgent,
	updateAgent,
} from "@/src/lib/api/agents.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import { fetchMcpTools, type McpTool } from "@/src/lib/api/mcp.ts";
import { fetchSpaces, type Space } from "@/src/lib/api/spaces.ts";
import {
	SettingsCard,
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

/** Friendly titles for well-known MCP server / tool-prefix groups. */
const APP_GROUP_LABELS: Record<string, string> = {
	ghost: "Ghost (type / paste / hotkeys)",
	shadow: "Shadow (screen capture)",
	spaces: "Spaces (docs & pages)",
	browser: "Browser",
	meetings: "Meetings",
	mail: "Mail",
	spider: "Spider (web crawl)",
	agentbrowser: "Agent Browser",
	rtk: "RTK",
	memory: "Memory",
	chat: "Chat / conversations",
};

export interface AgentAccessPanelProps {
	agentId: string;
	target: ApiTarget;
}

/** Group key for an MCP tool: server name, else prefix before `__`, else "other". */
function toolGroupKey(tool: McpTool): string {
	if (tool.server.trim().length > 0) {
		return tool.server.trim().toLowerCase();
	}
	const sep = tool.id.indexOf("__");
	if (sep > 0) {
		return tool.id.slice(0, sep).toLowerCase();
	}
	return "other";
}

function groupLabel(key: string): string {
	return APP_GROUP_LABELS[key] ?? key;
}

function toInput(agent: Agent, patch: Partial<AgentInput>): AgentInput {
	return {
		name: agent.name,
		description: agent.description,
		systemPrompt: agent.systemPrompt,
		engine: agent.engine,
		tools: agent.tools,
		composioActions: agent.composioActions,
		skills: agent.skills,
		identityProfileIds: agent.identityProfileIds,
		inference: agent.inference ?? undefined,
		memory: agent.memory,
		persona: agent.persona ?? undefined,
		orchestrator: agent.orchestrator,
		version: agent.version,
		...patch,
	};
}

/**
 * Compact cross-app access editor for a selected agent: Readable Spaces +
 * per-app MCP tool groups. Saves onto the agent record (same allowlists Agent
 * edit uses), so dictation/ask and chat share one source of truth.
 */
export function AgentAccessPanel({ agentId, target }: AgentAccessPanelProps) {
	const [agent, setAgent] = useState<Agent | null>(null);
	const [spaces, setSpaces] = useState<Space[]>([]);
	const [tools, setTools] = useState<McpTool[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);

	const reload = useCallback(async () => {
		setLoading(true);
		try {
			const [nextAgent, nextSpaces, nextTools] = await Promise.all([
				fetchAgent(target, agentId),
				fetchSpaces(target).catch(() => [] as Space[]),
				fetchMcpTools(target).catch(() => [] as McpTool[]),
			]);
			setAgent(nextAgent);
			setSpaces(nextSpaces);
			setTools(nextTools);
		} catch {
			setAgent(null);
			toast.error("Couldn't load agent access", {
				description: "Check your connection and try again.",
			});
		} finally {
			setLoading(false);
		}
	}, [agentId, target]);

	useEffect(() => {
		void reload();
	}, [reload]);

	const toolGroups = useMemo(() => {
		const map = new Map<string, McpTool[]>();
		for (const tool of tools) {
			const key = toolGroupKey(tool);
			const list = map.get(key) ?? [];
			list.push(tool);
			map.set(key, list);
		}
		return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
	}, [tools]);

	const selectedTools = useMemo(
		() => new Set(agent?.tools ?? []),
		[agent?.tools]
	);
	const selectedSpaces = useMemo(
		() => new Set(agent?.memory.space_ids ?? []),
		[agent?.memory.space_ids]
	);

	const persist = async (patch: Partial<AgentInput>) => {
		if (!agent || saving) {
			return;
		}
		setSaving(true);
		const previous = agent;
		const optimistic = {
			...agent,
			tools: patch.tools ?? agent.tools,
			memory: patch.memory
				? {
						space_ids: patch.memory.space_ids ?? agent.memory.space_ids,
						read_levels: patch.memory.read_levels ?? agent.memory.read_levels,
						write_enabled:
							patch.memory.write_enabled ?? agent.memory.write_enabled,
					}
				: agent.memory,
		};
		setAgent(optimistic);
		try {
			const saved = await updateAgent(target, agent.id, toInput(agent, patch));
			setAgent(saved);
		} catch {
			setAgent(previous);
			toast.error("Couldn't save agent access", {
				description: "Your change wasn't saved. Please try again.",
			});
		} finally {
			setSaving(false);
		}
	};

	const toggleSpace = (spaceId: string) => {
		if (!agent) {
			return;
		}
		const next = new Set(selectedSpaces);
		if (next.has(spaceId)) {
			next.delete(spaceId);
		} else {
			next.add(spaceId);
		}
		void persist({
			memory: {
				space_ids: [...next],
				read_levels: agent.memory.read_levels,
				write_enabled: agent.memory.write_enabled,
			},
		});
	};

	const groupEnabled = (groupTools: McpTool[]): boolean => {
		if (groupTools.length === 0) {
			return false;
		}
		return groupTools.every((t) => selectedTools.has(t.id));
	};

	const groupPartial = (groupTools: McpTool[]): boolean => {
		const n = groupTools.filter((t) => selectedTools.has(t.id)).length;
		return n > 0 && n < groupTools.length;
	};

	const toggleGroup = (groupTools: McpTool[], enable: boolean) => {
		if (!agent) {
			return;
		}
		const next = new Set(selectedTools);
		for (const tool of groupTools) {
			if (enable) {
				next.add(tool.id);
			} else {
				next.delete(tool.id);
			}
		}
		void persist({ tools: [...next] });
	};

	if (loading) {
		return (
			<SettingsSection
				caption="Loading what this agent can reach…"
				title="Agent access"
			>
				<SettingsCard>
					<p className="text-muted-foreground text-sm">Loading…</p>
				</SettingsCard>
			</SettingsSection>
		);
	}

	if (!agent) {
		return null;
	}

	return (
		<SettingsSection
			caption={
				<>
					Cross-app reach for <strong>{agent.name}</strong>. Spaces feed
					retrieval; app tool groups unlock that app&apos;s MCP tools (Ghost,
					Spaces pages, Browser, …). Same allowlists as Agent edit — changes
					apply everywhere this agent runs, including agent-ask.
				</>
			}
			title="Agent access"
		>
			<SettingsCard className="space-y-4">
				<div className="space-y-2">
					<span className="font-medium text-sm">Readable Spaces</span>
					<p className="text-muted-foreground text-xs">
						Spaces this agent may read for retrieval (pages, docs). Leave all
						unchecked to inject none.
					</p>
					{spaces.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							No Spaces yet. Create one on the Spaces page to grant access.
						</p>
					) : (
						<div className="flex flex-col gap-2">
							{spaces.map((space) => {
								const checkId = `dictation-access-space-${space.id}`;
								return (
									<div className="flex items-center gap-3" key={space.id}>
										<Checkbox
											checked={selectedSpaces.has(space.id)}
											disabled={saving}
											id={checkId}
											onCheckedChange={() => toggleSpace(space.id)}
										/>
										<Label
											className="cursor-pointer font-normal text-sm"
											htmlFor={checkId}
										>
											{space.name}
										</Label>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</SettingsCard>

			<SettingsGroup>
				{toolGroups.length === 0 ? (
					<SettingsItem
						description="No MCP tools are registered yet. Enable apps/plugins that expose tools (Ghost, Spaces, Browser, …) to grant them here."
						title="App tools"
					/>
				) : (
					toolGroups.map(([key, groupTools]) => {
						const on = groupEnabled(groupTools);
						const partial = groupPartial(groupTools);
						return (
							<SettingsItem
								actions={
									<Switch
										aria-label={`Allow ${groupLabel(key)}`}
										checked={on || partial}
										disabled={saving}
										onCheckedChange={(v) => toggleGroup(groupTools, v)}
									/>
								}
								description={
									partial
										? `${groupTools.filter((t) => selectedTools.has(t.id)).length} of ${groupTools.length} tools allowed`
										: `${groupTools.length} tool${groupTools.length === 1 ? "" : "s"} from this app`
								}
								key={key}
								title={groupLabel(key)}
							/>
						);
					})
				)}
			</SettingsGroup>
		</SettingsSection>
	);
}
