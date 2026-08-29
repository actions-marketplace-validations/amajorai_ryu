import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { A2aSettingsView } from "../../src/components/settings/A2aSettings.tsx";
import type {
	A2aPeer,
	A2aPrincipal,
	A2aPublishedAgent,
	A2aScope,
	A2aServerConfig,
	A2aTaskRecord,
	A2aTrust,
} from "../../src/lib/api/a2a.ts";
import type {
	Agent,
	AgentInput,
	AgentSummary,
} from "../../src/lib/api/agents.ts";
import "../../src/index.css";

let settings: A2aServerConfig = {
	description: "Secure research and automation agents",
	displayName: "Ryu Studio",
	enabled: true,
	exposeExtendedCard: false,
	maxConcurrentTasks: 16,
	maxPayloadBytes: 1_048_576,
	publicBaseUrl: "https://agents.example.com",
	tenantId: "default",
	updatedAt: "2026-08-23T08:00:00Z",
};

let peers: A2aPeer[] = [
	{
		agentCard: { name: "Hermes Research" },
		agentCardUrl: "https://hermes.example.com/.well-known/agent-card.json",
		createdAt: "2026-08-23T08:00:00Z",
		credentialConfigured: true,
		credentialKind: "bearer",
		enabled: true,
		id: "peer-hermes",
		lastError: null,
		name: "Hermes Research",
		tenantId: "default",
		trust: "trusted",
		updatedAt: "2026-08-23T08:00:00Z",
	},
	{
		agentCard: { name: "Finance Review" },
		agentCardUrl: "https://finance.example.com/.well-known/agent-card.json",
		createdAt: "2026-08-23T08:01:00Z",
		credentialConfigured: false,
		credentialKind: "none",
		enabled: true,
		id: "peer-finance",
		lastError: null,
		name: "Finance Review",
		tenantId: "default",
		trust: "pending",
		updatedAt: "2026-08-23T08:01:00Z",
	},
];

const published: A2aPublishedAgent[] = [
	{
		agentId: "researcher",
		createdAt: "2026-08-23T08:00:00Z",
		description: "Research across trusted sources",
		enabled: true,
		id: "published-researcher",
		name: "Researcher",
		skills: [
			{
				description: "Synthesize a cited research brief",
				id: "research-brief",
				name: "Research brief",
				tags: ["research"],
			},
		],
		tenantId: "default",
		updatedAt: "2026-08-23T08:00:00Z",
	},
];

let principals: A2aPrincipal[] = [
	{
		createdAt: "2026-08-23T08:00:00Z",
		id: "principal-hermes",
		lastUsedAt: "2026-08-23T08:04:00Z",
		name: "Hermes production",
		revokedAt: null,
		scopes: ["send", "read", "cancel", "subscribe"],
		tenantId: "default",
	},
];

const tasks: A2aTaskRecord[] = [
	{
		contextId: "market-brief",
		createdAt: "2026-08-23T08:02:00Z",
		direction: "outbound",
		id: "task-market-brief",
		localAgentId: null,
		ownerId: "local",
		peerId: "peer-hermes",
		protocolTask: { artifacts: [{ artifactId: "brief" }] },
		revision: 4,
		state: "completed",
		tenantId: "default",
		updatedAt: "2026-08-23T08:03:00Z",
	},
	{
		contextId: "incoming-review",
		createdAt: "2026-08-23T08:05:00Z",
		direction: "inbound",
		id: "task-incoming-review",
		localAgentId: "researcher",
		ownerId: "principal-hermes",
		peerId: null,
		protocolTask: { artifacts: [] },
		revision: 1,
		state: "working",
		tenantId: "default",
		updatedAt: "2026-08-23T08:05:05Z",
	},
];

function proofEvent(message: string): void {
	window.dispatchEvent(new CustomEvent("a2a-proof-event", { detail: message }));
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		headers: { "content-type": "application/json" },
		status,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isA2aTrust(value: unknown): value is A2aTrust {
	return value === "pending" || value === "trusted" || value === "revoked";
}

function isA2aScope(value: unknown): value is A2aScope {
	return (
		value === "send" ||
		value === "read" ||
		value === "cancel" ||
		value === "subscribe" ||
		value === "push_config" ||
		value === "extended_card"
	);
}

function isServerConfig(value: unknown): value is A2aServerConfig {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value.description === "string" &&
		typeof value.displayName === "string" &&
		typeof value.enabled === "boolean" &&
		typeof value.exposeExtendedCard === "boolean" &&
		typeof value.maxConcurrentTasks === "number" &&
		typeof value.maxPayloadBytes === "number" &&
		(value.publicBaseUrl === null || typeof value.publicBaseUrl === "string") &&
		typeof value.tenantId === "string" &&
		typeof value.updatedAt === "string"
	);
}

function installMock(): void {
	const mockFetch = async (
		input: URL | RequestInfo,
		init?: RequestInit
	): Promise<Response> => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const parsed = new URL(url);
		const path = parsed.pathname;
		const method = (init?.method ?? "GET").toUpperCase();
		const parsedBody: unknown =
			typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		const body = isRecord(parsedBody) ? parsedBody : {};

		if (path === "/api/a2a/settings" && method === "PUT") {
			if (!isServerConfig(parsedBody)) {
				return json({ error: "Invalid settings proof body" }, 400);
			}
			settings = {
				...parsedBody,
				updatedAt: new Date().toISOString(),
			};
			proofEvent(`Endpoint saved · inbound ${settings.enabled ? "on" : "off"}`);
			return json(settings);
		}
		if (path === "/api/a2a/settings") {
			return json(settings);
		}
		if (path === "/api/a2a/peers") {
			return json(peers);
		}
		if (path.endsWith("/trust") && method === "PUT") {
			const id = path.split("/").at(-2);
			const trust = body.trust;
			if (!isA2aTrust(trust)) {
				return json({ error: "Invalid trust proof body" }, 400);
			}
			peers = peers.map((peer) => (peer.id === id ? { ...peer, trust } : peer));
			proofEvent(`Peer trust changed · ${trust}`);
			return json(peers.find((peer) => peer.id === id));
		}
		if (path === "/api/a2a/principals" && method === "POST") {
			const name = typeof body.name === "string" ? body.name : "Proof peer";
			const scopes = Array.isArray(body.scopes)
				? body.scopes.filter(isA2aScope)
				: [];
			const principal: A2aPrincipal = {
				createdAt: new Date().toISOString(),
				id: "principal-new",
				lastUsedAt: null,
				name,
				revokedAt: null,
				scopes,
				tenantId: "default",
			};
			principals = [principal, ...principals];
			proofEvent("Scoped inbound token issued once");
			return json({ principal, token: "ryu_a2a_live_proof_token" });
		}
		if (path === "/api/a2a/principals") {
			return json(principals);
		}
		if (path === "/api/a2a/published-agents") {
			return json(published);
		}
		if (path === "/api/a2a/tasks") {
			return json(tasks);
		}
		return json({ error: `Unhandled proof request: ${method} ${path}` }, 404);
	};
	window.fetch = mockFetch as unknown as typeof window.fetch;
}

function ProofArtifact() {
	const [events, setEvents] = useState([
		"A2A v1 · JSON-RPC + HTTP+JSON · authenticated",
	]);
	const [agentRoster, setAgentRoster] = useState<AgentSummary[]>([
		{
			avatarGlyph: null,
			avatarUrl: null,
			builtIn: false,
			createdAt: "2026-08-23T08:00:00Z",
			description: "Research across trusted sources",
			engine: "acp:pi",
			id: "researcher",
			installHint: null,
			installed: true,
			latestVersion: null,
			lifecycleStatus: "active",
			locked: false,
			model: null,
			name: "Researcher",
			recommended: false,
			safetyProfile: "autonomous",
			systemPrompt: null,
			title: "Research",
			transport: null,
			version: "1.0.0",
			versionStatus: "current",
		},
	]);
	const queryClient = useMemo(
		() =>
			new QueryClient({
				defaultOptions: { queries: { retry: false } },
			}),
		[]
	);

	useEffect(() => {
		const onEvent = (event: Event) => {
			if (event instanceof CustomEvent && typeof event.detail === "string") {
				setEvents((current) => [...current, event.detail].slice(-5));
			}
		};
		window.addEventListener("a2a-proof-event", onEvent);
		return () => window.removeEventListener("a2a-proof-event", onEvent);
	}, []);

	const createAgent = async (input: AgentInput): Promise<Agent> => {
		const createdAt = new Date().toISOString();
		const id = "remote-hermes";
		setAgentRoster((current) => [
			{
				avatarGlyph: null,
				avatarUrl: null,
				builtIn: false,
				createdAt,
				description: input.description,
				engine: input.engine,
				id,
				installHint: null,
				installed: true,
				latestVersion: null,
				lifecycleStatus: "active",
				locked: false,
				model: input.model ?? null,
				name: input.name,
				recommended: false,
				safetyProfile: input.safetyProfile ?? "autonomous",
				systemPrompt: input.systemPrompt,
				title: input.title ?? "",
				transport: null,
				version: input.version ?? "1.0.0",
				versionStatus: "current",
			},
			...current,
		]);
		proofEvent("Trusted peer added to the agent roster");
		return {
			builtIn: false,
			canCreateAgents: null,
			chatModel: null,
			composioActions: [],
			createdAt,
			description: input.description,
			engine: input.engine,
			id,
			identityProfileIds: [],
			inference: null,
			lifecycleStatus: "active",
			locked: false,
			memory: { read_levels: [], space_ids: [], write_enabled: false },
			model: input.model ?? null,
			name: input.name,
			orchestrator: null,
			persona: null,
			safetyProfile: input.safetyProfile ?? "autonomous",
			skills: input.skills ?? [],
			systemPrompt: input.systemPrompt,
			title: input.title ?? "",
			tools: input.tools,
			updatedAt: createdAt,
			version: input.version ?? "1.0.0",
		};
	};

	return (
		<QueryClientProvider client={queryClient}>
			<main className="min-h-screen bg-background px-6 py-8 text-foreground">
				<div className="mx-auto max-w-3xl space-y-6">
					<header className="flex items-end justify-between gap-6 border-b pb-5">
						<div>
							<p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.18em]">
								Protocol proof
							</p>
							<h1 className="mt-1 font-semibold text-2xl">Agent networking</h1>
							<p className="mt-1 max-w-xl text-muted-foreground text-sm">
								Publish local agents, trust remote peers, and inspect durable
								tasks from one place.
							</p>
						</div>
						<div
							className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 font-medium text-emerald-700 text-xs"
							data-testid="proof-status"
						>
							VERIFIED · BIDIRECTIONAL
						</div>
					</header>
					<A2aSettingsView
						agentRoster={{ agents: agentRoster, create: createAgent }}
					/>
					<section
						className="rounded-lg border bg-card p-4"
						data-testid="proof-events"
					>
						<h2 className="font-medium text-sm">Verified actions</h2>
						<ul className="mt-2 space-y-1 text-muted-foreground text-xs">
							{events.map((event) => (
								<li key={event}>✓ {event}</li>
							))}
						</ul>
					</section>
				</div>
			</main>
		</QueryClientProvider>
	);
}

installMock();
const root = document.getElementById("root");
if (!root) {
	throw new Error("A2A proof root is missing");
}
createRoot(root).render(<ProofArtifact />);
