// apps/desktop/src/components/gateway/McpSection.tsx
//
// The Gateway "MCP" surface — the Ryu MCP server layer. Two blocks:
//
//  1. Servers — every MCP server Core has registered (`/api/mcp/servers`), with
//     its command/args, enabled state, and whether the binary is on disk.
//  2. Tools — every tool the registered servers advertise (`/api/mcp/tools`),
//     grouped by server, so you can see what a host (Claude Desktop, Cursor)
//     can reach through this node.
//
// This is a READ-ONLY inventory + status view — the mechanism for adding/
// removing servers and editing per-agent allowlists is the Tools page in the
// app (see `@ryu/blocks` Tools surface). Management links out from here.

import { Badge } from "@ryu/ui/components/badge.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { useEffect, useState } from "react";
import {
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "@/src/components/settings/shared/settings-items.tsx";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	fetchMcpServers,
	fetchMcpTools,
	type McpServer,
	type McpTool,
} from "@/src/lib/api/mcp.ts";

function ServersList({
	servers,
	loading,
	error,
}: {
	error: string | null;
	loading: boolean;
	servers: McpServer[];
}) {
	if (loading) {
		return (
			<div className="flex items-center gap-2 px-3 text-muted-foreground text-sm">
				<Spinner className="size-4" />
				Loading…
			</div>
		);
	}
	if (error) {
		return <p className="px-3 text-destructive text-sm">{error}</p>;
	}
	if (servers.length === 0) {
		return (
			<p className="px-3 text-muted-foreground text-sm">
				No MCP servers registered. Add one from the Tools page.
			</p>
		);
	}
	return (
		<SettingsGroup>
			{servers.map((s) => (
				<SettingsItem
					actions={
						<div className="flex items-center gap-2">
							{s.enabled ? (
								<Badge variant="default">enabled</Badge>
							) : (
								<Badge variant="secondary">disabled</Badge>
							)}
							{s.available === false ? (
								<Badge variant="destructive">missing</Badge>
							) : null}
						</div>
					}
					description={
						<span className="block max-w-full truncate font-mono text-xs">
							{s.command}
							{s.args.length > 0 ? ` ${s.args.join(" ")}` : ""}
						</span>
					}
					key={s.name}
					title={s.name}
				/>
			))}
		</SettingsGroup>
	);
}

function ToolsList({
	servers,
	tools,
	loading,
	error,
}: {
	error: string | null;
	loading: boolean;
	servers: McpServer[];
	tools: McpTool[];
}) {
	const byServer = new Map<string, McpTool[]>();
	for (const t of tools) {
		const list = byServer.get(t.server) ?? [];
		list.push(t);
		byServer.set(t.server, list);
	}
	const enabled = new Set(servers.filter((s) => s.enabled).map((s) => s.name));
	const visible = [...byServer.entries()].filter(([server]) =>
		enabled.has(server)
	);

	if (loading) {
		return (
			<div className="flex items-center gap-2 px-3 text-muted-foreground text-sm">
				<Spinner className="size-4" />
				Loading…
			</div>
		);
	}
	if (error) {
		return <p className="px-3 text-destructive text-sm">{error}</p>;
	}
	if (tools.length === 0) {
		return (
			<p className="px-3 text-muted-foreground text-sm">
				No tools advertised by the registered servers yet.
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-3 px-3">
			{visible.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No enabled servers advertise tools.
				</p>
			) : (
				visible.map(([server, list]) => (
					<div className="flex flex-col gap-1" key={server}>
						<span className="font-medium text-sm">{server}</span>
						<div className="flex flex-wrap gap-2">
							{list.map((t) => (
								<Badge
									className="font-mono text-xs"
									key={t.id}
									variant="secondary"
								>
									{t.name}
								</Badge>
							))}
						</div>
					</div>
				))
			)}
		</div>
	);
}

export function McpSection({ target }: { target: ApiTarget }) {
	const [servers, setServers] = useState<McpServer[]>([]);
	const [tools, setTools] = useState<McpTool[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		Promise.all([fetchMcpServers(target), fetchMcpTools(target)])
			.then(([s, t]) => {
				if (!cancelled) {
					setServers(s);
					setTools(t);
					setError(null);
				}
			})
			.catch((e: unknown) => {
				if (!cancelled) {
					setError(
						e instanceof Error ? e.message : "Failed to load MCP servers"
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [target]);

	return (
		<div className="flex flex-col gap-4">
			<SettingsSection
				caption="The MCP servers this node exposes. A host (Claude Desktop, Cursor, …) that connects to Ryu can call the tools below through the same governance as everything else."
				title="MCP servers"
			>
				<ServersList error={error} loading={loading} servers={servers} />
			</SettingsSection>

			<SettingsSection
				caption="Tools advertised by enabled servers, grouped by server. Per-agent allowlists are managed on the Tools page."
				title="Available tools"
			>
				<ToolsList
					error={error}
					loading={loading}
					servers={servers}
					tools={tools}
				/>
			</SettingsSection>
		</div>
	);
}
