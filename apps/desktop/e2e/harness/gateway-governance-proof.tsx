import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { createRoot } from "react-dom/client";
import { EnvironmentsSection } from "../../src/components/gateway/EnvironmentsSection.tsx";
import { GitSettingsSection } from "../../src/components/gateway/GitSettingsSection.tsx";
import { HooksSection } from "../../src/components/gateway/HooksSection.tsx";
import { WorktreesSection } from "../../src/components/gateway/WorktreesSection.tsx";
import { ConnectedDevicesSection } from "../../src/components/settings/ConnectionsTab.tsx";
import { NodeSelector } from "../../src/components/shell/NodeSelector.tsx";
import { EntitlementProvider } from "../../src/contexts/entitlement-context.tsx";
import { SystemStatusProvider } from "../../src/contexts/SystemStatusContext.tsx";
import { TabsProvider } from "../../src/contexts/TabsContext.tsx";
import { LOCAL_FALLBACK, useNodeStore } from "../../src/store/useNodeStore.ts";
import "../../src/index.css";

const TARGET = {
	token: null,
	url: "http://127.0.0.1:7980",
};

const governance = {
	layers: [
		{
			revision: 4,
			scope: "node",
			values: {
				git: {
					branchPrefix: "codex/",
					createDraftPullRequests: true,
					mergeMethod: "merge",
					reviewDelivery: "inline",
				},
				worktrees: { autoDelete: true, autoDeleteLimit: 15 },
			},
			writable: true,
		},
		{
			revision: 8,
			scope: "organization",
			values: {
				git: { createDraftPullRequests: false },
			},
			writable: false,
		},
		{
			revision: 8,
			scope: "team",
			values: {},
			writable: false,
		},
		{
			revision: 4,
			scope: "user",
			values: {},
			writable: true,
		},
	],
	schemaVersion: 1,
};

const hooks = {
	hooks: [
		{
			effectiveEnabled: false,
			enabled: true,
			handler: {
				display: "Sandboxed JavaScript",
				kind: "sandbox_js",
				path: "hooks/review.js",
			},
			hookKey: "com.example.security::review",
			id: "review",
			localOverrides: {},
			matcher: { flag: "io.example.review" },
			ownerId: "com.example.security",
			ownerName: "Security Guidance",
			phase: "post_assistant_turn",
			pluginEnabled: true,
			priority: 4,
			reviewRequired: true,
			source: "plugin",
			trusted: false,
		},
		{
			effectiveEnabled: true,
			enabled: true,
			handler: {
				display: "Sandboxed JavaScript",
				kind: "sandbox_js",
				path: "hooks/session-start.js",
			},
			hookKey: "com.example.security::session-start",
			id: "session-start",
			localOverrides: {},
			ownerId: "com.example.security",
			ownerName: "Security Guidance",
			phase: "session_start",
			pluginEnabled: true,
			priority: 2,
			reviewRequired: false,
			source: "plugin",
			trusted: true,
		},
		{
			effectiveEnabled: true,
			enabled: true,
			handler: {
				display: "Command",
				kind: "command",
				path: "~/.ryu/hooks/lint.sh",
			},
			hookKey: "user-config::lint",
			id: "lint",
			localOverrides: { user: { enabled: true, trusted: true } },
			matcher: { commands: ["/review"] },
			ownerId: "user-config",
			ownerName: "User config",
			phase: "user_prompt_submit",
			pluginEnabled: true,
			priority: 1,
			reviewRequired: false,
			source: "config",
			trusted: true,
		},
	],
};

const connections = {
	client_count: 4,
	data: [
		{
			client_id: "desktop-proof",
			client_label: "Proof desktop",
			first_seen: 1000,
			last_seen: Math.floor(Date.now() / 1000),
			surface: "desktop",
			user_id: "jiawei@example.com",
			user_name: "Jiawei",
		},
		{
			client_id: "cli-proof",
			client_label: "release shell",
			first_seen: 1000,
			last_seen: Math.floor(Date.now() / 1000) - 12,
			surface: "cli",
			user_id: null,
			user_name: null,
		},
		{
			client_id: "phone-proof",
			client_label: "iPhone",
			first_seen: 1000,
			last_seen: Math.floor(Date.now() / 1000) - 40,
			surface: "mobile",
			user_id: "jiawei@example.com",
			user_name: "Jiawei",
		},
		{
			client_id: "extension-proof",
			client_label: "Chrome",
			first_seen: 1000,
			last_seen: Math.floor(Date.now() / 1000) - 65,
			surface: "extension",
			user_id: null,
			user_name: null,
		},
	],
	ttl_secs: 90,
	user_count: 2,
};

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		headers: { "Content-Type": "application/json" },
		status: 200,
	});
}

window.fetch = async (input) => {
	const url =
		typeof input === "string"
			? input
			: input instanceof Request
				? input.url
				: input.toString();
	if (url.endsWith("/api/hooks/management")) {
		return jsonResponse(hooks);
	}
	if (url.endsWith("/api/gateway/governance")) {
		return jsonResponse(governance);
	}
	if (url.endsWith("/api/connections")) {
		return jsonResponse(connections);
	}
	if (url.endsWith("/api/system/status")) {
		return jsonResponse({
			engine: { active: "llamacpp", running: true },
			gateway: { reachable: true },
			mesh: null,
			sidecars: [
				{ name: "core", running: true },
				{ name: "gateway", running: true },
			],
		});
	}
	if (url.endsWith("/api/system/info")) {
		return jsonResponse({
			cpu_cores: 10,
			cpu_name: "Proof machine",
			disk_human: "512 GB",
			hostname: "proof-machine",
			ram_human: "32 GB",
			used_disk_human: "120 GB",
			used_ram_human: "8 GB",
		});
	}
	return jsonResponse({});
};

useNodeStore.setState({
	defaultNode: LOCAL_FALLBACK.name,
	localNodes: [LOCAL_FALLBACK],
	nodes: [LOCAL_FALLBACK],
});

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

function Proof() {
	return (
		<ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
			<QueryClientProvider client={queryClient}>
				<EntitlementProvider>
					<TabsProvider>
						<SystemStatusProvider>
							<main className="min-h-screen bg-background px-8 py-10 text-foreground">
								<div className="mx-auto max-w-6xl space-y-8">
									<header>
										<p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.18em]">
											Ryu · Gateway governance
										</p>
										<h1 className="mt-2 font-heading text-3xl tracking-tight">
											Hooks, developer defaults, and connected clients
										</h1>
										<p className="mt-2 max-w-3xl text-muted-foreground text-sm">
											Effective controls follow the same user → team →
											organization → node hierarchy used by managed MCP and
											skills.
										</p>
									</header>
									<div className="rounded-2xl border border-border/70 bg-sidebar px-4 py-3">
										<p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
											Node selector
										</p>
										<NodeSelector mode="compact-dropdown" />
									</div>
									<div className="grid gap-6 lg:grid-cols-2">
										<div className="lg:col-span-2">
											<HooksSection canConfigure target={TARGET} />
										</div>
										<GitSettingsSection canConfigure target={TARGET} />
										<WorktreesSection canConfigure target={TARGET} />
										<EnvironmentsSection />
										<ConnectedDevicesSection />
									</div>
								</div>
							</main>
						</SystemStatusProvider>
					</TabsProvider>
				</EntitlementProvider>
			</QueryClientProvider>
		</ThemeProvider>
	);
}

createRoot(document.getElementById("root")!).render(<Proof />);
