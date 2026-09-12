import { ScorecardPanel } from "@ryu/marketplace/catalog/detail/scorecard-panel";
import {
	runAgentScorecard,
	runScorecard,
} from "@ryu/marketplace/catalog/scorecard";
import { Button } from "@ryu/ui/components/button.tsx";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { GatewayPostureCard } from "@/src/components/gateway/GatewayPostureCard.tsx";
import { runCatalogScan } from "@/src/lib/api/catalog-scan.ts";
import type { AgentHealthInput } from "../../../../packages/marketplace/src/catalog/agent-scorecard-types.ts";
import "../../src/index.css";

const fixtureMode = new URLSearchParams(window.location.search).get("mode");
const target = { url: window.location.origin, token: "audit-proof" };
const agent: AgentHealthInput = {
	name: "Research assistant",
	description: "Research public sources and cite findings.",
	instructions:
		"Find reliable public sources and explain uncertainty. Ask before changing external data.",
	lifecycleStatus: "trial",
	memoryWriteEnabled: false,
	model: { configured: true },
	runtime: { status: "ready", label: "Ryu" },
	safetyProfile: "approval_required",
	automation: { scheduleEnabled: false, triggerCount: 0 },
	access: {
		composioActionCount: 0,
		highImpactCount: 0,
		identityProfileCount: 0,
	},
	skills: {
		allSelected: false,
		availableCount: 20,
		selectedCount: 2,
		loaded: true,
	},
	tools: {
		allSelected: false,
		availableCount: 30,
		selectedCount: 3,
		loaded: true,
	},
};
const entry = {
	id: "com.example.research",
	name: "Research tools",
	description: "Read public sources and preserve citations.",
	version: "1.0.0",
	kinds: ["tool"],
};
const detail = {
	description: entry.description,
	readme:
		"# Research tools\n\n" +
		"Reads public sources and returns cited excerpts. ".repeat(12),
	version: "1.0.0",
	license: "MIT",
	repositoryUrl: "https://example.com/research",
	permissions: { declared: true, network: ["https://example.com"] },
};
const scorecard = runScorecard(entry, detail);
function Story() {
	const [surface, setSurface] = useState("marketplace");
	const [openedConversation, setOpenedConversation] = useState<string | null>(
		null
	);
	const [revision, setRevision] = useState(0);
	const input = {
		...agent,
		name: revision ? "Updated research assistant" : agent.name,
	};
	const agentCard = runAgentScorecard(input);
	return (
		<main className="min-h-svh bg-background px-4 py-6 text-foreground">
			<div className="mx-auto max-w-3xl space-y-6">
				<header>
					<p className="text-muted-foreground text-xs">Ryu · Health</p>
					<h1 className="mt-1 font-semibold text-2xl">
						{surface === "gateway"
							? "Gateway"
							: surface === "agent"
								? input.name
								: entry.name}
					</h1>
				</header>
				<nav aria-label="Audit surfaces" className="flex flex-wrap gap-2">
					{["marketplace", "agent", "gateway"].map((item) => (
						<Button
							key={item}
							onClick={() => {
								setSurface(item);
								setOpenedConversation(null);
							}}
							size="sm"
							variant={surface === item ? "secondary" : "ghost"}
						>
							{item === "marketplace"
								? "Marketplace"
								: item === "agent"
									? "Agent health"
									: "Gateway doctor"}
						</Button>
					))}
				</nav>
				{surface === "gateway" ? (
					<GatewayPostureCard
						canConfigure={false}
						compact={false}
						onOpenAuditConversation={setOpenedConversation}
						reachable
						target={target}
					/>
				) : surface === "agent" ? (
					<>
						<Button
							onClick={() => setRevision(revision + 1)}
							size="sm"
							variant="ghost"
						>
							Edit agent name
						</Button>
						<ScorecardPanel
							agentScan={() =>
								runCatalogScan(target, {
									kind: "agent",
									id: "research",
									name: input.name,
									metadata: { configuration: input },
									scorecard: agentCard,
								})
							}
							disclaimer={
								<p className="text-muted-foreground text-xs leading-relaxed">
									These checks update as you edit the agent. They inspect its
									configuration only; they do not run the agent or replace Core
									and Gateway authorization.
								</p>
							}
							key={revision}
							onOpenConversation={setOpenedConversation}
							rulesetLabel="Agent ruleset"
							scorecard={agentCard}
							title="Agent health"
						/>
					</>
				) : (
					<ScorecardPanel
						agentScan={() =>
							runCatalogScan(target, {
								kind: "plugin",
								id: entry.id,
								name: fixtureMode ? `${fixtureMode}-fixture` : entry.name,
								description: entry.description,
								readme: detail.readme,
								scorecard,
							})
						}
						onOpenConversation={setOpenedConversation}
						scorecard={scorecard}
					/>
				)}
			</div>
			{openedConversation ? (
				<p role="status">Opened audit conversation: {openedConversation}</p>
			) : null}
		</main>
	);
}
const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
