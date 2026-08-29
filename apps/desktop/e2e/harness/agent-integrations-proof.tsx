import {
	AgentByoaView,
	AgentIntegrationsView,
} from "@ryu/blocks/desktop/agent-edit.tsx";
import {
	type AgentIntegrationSnippetLang,
	buildAgentIntegrationSnippet,
	buildGitHubActionsSnippet,
} from "@ryu/blocks/desktop/agent-integration-snippets";
import { Badge } from "@ryu/ui/components/badge.tsx";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

const AGENT_ID = "review-agent";
const CORE_URL = "http://127.0.0.1:7980";

function AgentIntegrationsProof() {
	const [copied, setCopied] = useState(false);
	const [docsOpened, setDocsOpened] = useState(false);
	const [language, setLanguage] =
		useState<AgentIntegrationSnippetLang>("typescript");
	const snippet = useMemo(
		() =>
			buildAgentIntegrationSnippet({
				agentId: AGENT_ID,
				baseUrl: CORE_URL,
				hasToken: true,
				language,
			}),
		[language]
	);

	const copySnippet = async () => {
		try {
			await navigator.clipboard.writeText(snippet);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2000);
		} catch {
			setCopied(false);
		}
	};

	return (
		<main className="min-h-screen bg-background px-6 py-10 text-foreground">
			<div className="mx-auto max-w-5xl">
				<header className="mb-7">
					<p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.2em]">
						Production component proof
					</p>
					<div className="mt-2 flex flex-wrap items-center gap-3">
						<h1 className="font-semibold text-3xl tracking-tight">
							Agent integrations
						</h1>
						<Badge variant="secondary">Saved agent</Badge>
					</div>
					<p className="mt-3 max-w-2xl text-muted-foreground">
						Copy a working call for the selected agent, then choose the
						integration path that fits the rest of your stack.
					</p>
				</header>

				<div className="rounded-3xl border bg-card p-4 shadow-sm sm:p-6">
					<AgentIntegrationsView
						agentId={AGENT_ID}
						byoaPanel={<AgentByoaView agentId={AGENT_ID} hasKey />}
						copied={copied}
						coreUrl={CORE_URL}
						githubActionsSnippet={buildGitHubActionsSnippet(AGENT_ID)}
						hasToken
						lang={language}
						onCopy={copySnippet}
						onLangChange={setLanguage}
						onOpenDocs={() => setDocsOpened(true)}
						snippet={snippet}
					/>
				</div>

				<p aria-live="polite" className="mt-4 text-muted-foreground text-xs">
					<span data-testid="docs-opened">
						{docsOpened ? "Documentation requested" : "Documentation idle"}
					</span>
				</p>
			</div>
		</main>
	);
}

const root = document.getElementById("root");
if (!root) {
	throw new Error("Proof root is missing");
}

createRoot(root).render(<AgentIntegrationsProof />);
