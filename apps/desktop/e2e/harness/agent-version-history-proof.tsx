import { Button } from "@ryu/ui/components/button.tsx";
import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	AgentSettingsForm,
	type AgentSettingsFormProps,
} from "../../../../packages/blocks/src/desktop/agent-edit.tsx";
import { AgentVersionHistoryPanel } from "../../src/components/agents/AgentVersionHistoryPanel.tsx";
import type {
	VersionMeta,
	VersionSource,
} from "../../src/components/versioning/VersionHistory.tsx";
import "../../src/index.css";

const BASELINE_SOURCE = `{
  "name": "Research Copilot",
  "version": "1.0.0",
  "system_prompt": "Answer with cited research."
}`;

const CURRENT_SOURCE = `{
  "name": "Research Copilot",
  "version": "1.1.0",
  "system_prompt": "Answer with cited research and flag uncertainty."
}`;

const BASELINE_VERSION: VersionMeta = {
	createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
	id: "agent-baseline",
	label: "Regression baseline",
	title: "Research Copilot · v1.0.0",
};

const EDITOR_PROPS = {
	acpCommand: "",
	chatModel: "acp:ryu",
	composioActions: [],
	composioConfigured: false,
	composioToolkit: null,
	composioToolkitItems: [],
	composioTriggers: [],
	connectedAccountId: "",
	customCron: "",
	customTone: "",
	dailyTime: "09:00",
	engineOptions: [{ id: "acp:ryu", label: "Ryu" }],
	isBuiltIn: false,
	isLocked: false,
	isNew: false,
	memoryReadLevels: new Set<string>(),
	memorySpaceIds: new Set<string>(),
	memoryWriteEnabled: false,
	name: "Research Copilot",
	personaDisplayName: "",
	rules: [],
	scheduleEnabled: false,
	schedulePhrase: "daily",
	selectedComposio: new Set<string>(),
	selectedSkills: new Set<string>(),
	selectedTools: new Set<string>(["web.search"]),
	skills: [],
	spaces: [],
	systemPrompt: "Answer with cited research and flag uncertainty.",
	tone: "neutral",
	toneOptions: [{ label: "Neutral", value: "neutral" }],
	tools: ["web.search"],
	triggerError: null,
	triggerSlug: "",
	triggerSubs: [],
	weeklyDay: "monday",
	weeklyTime: "09:00",
} satisfies AgentSettingsFormProps;

function AgentVersionHistoryProof() {
	const versionsRef = useRef<VersionMeta[]>([BASELINE_VERSION]);
	const valuesRef = useRef<Record<string, string>>({
		[BASELINE_VERSION.id]: BASELINE_SOURCE,
	});
	const currentRef = useRef(CURRENT_SOURCE);
	const [currentSource, setCurrentSource] = useState(CURRENT_SOURCE);
	const [currentVersion, setCurrentVersion] = useState("1.1.0");
	const [status, setStatus] = useState("Current saved definition · v1.1.0");

	const versionSource = useMemo<VersionSource>(
		() => ({
			getValue: async (versionId) => valuesRef.current[versionId] ?? "",
			list: async () => [...versionsRef.current],
			restore: async (versionId) => {
				const value = valuesRef.current[versionId];
				const version = versionsRef.current.find(
					(item) => item.id === versionId
				);
				if (!(value && version)) {
					throw new Error("Version not found");
				}
				currentRef.current = value;
				setCurrentSource(value);
				setCurrentVersion(version.title?.split("v").at(-1) ?? "1.0.0");
				setStatus(`Restored ${version.title ?? "saved definition"}`);
			},
			snapshot: async (label) => {
				const id = "agent-current";
				valuesRef.current[id] = currentRef.current;
				versionsRef.current = [
					...versionsRef.current,
					{
						createdAt: Date.now(),
						id,
						label: label ?? "Agent saved",
						title: "Research Copilot · v1.1.0",
					},
				];
			},
		}),
		[]
	);

	return (
		<main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-8">
			<div className="mx-auto flex max-w-5xl flex-col gap-6">
				<header className="flex flex-col gap-3">
					<p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.2em]">
						Production editor proof
					</p>
					<h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">
						Agent configuration versions
					</h1>
					<p className="max-w-2xl text-muted-foreground text-sm leading-relaxed">
						Save a complete agent definition, compare it with a regression
						baseline, and restore the tested configuration when a change is not
						safe.
					</p>
				</header>

				<section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
					<div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/30 p-4">
						<div>
							<h2 className="font-medium text-sm">Research Copilot</h2>
							<p className="mt-1 text-muted-foreground text-xs">
								Saved configuration · v{currentVersion}
							</p>
						</div>
						<span
							className="text-muted-foreground text-xs"
							data-testid="version-status"
						>
							{status}
						</span>
					</div>

					<AgentSettingsForm
						{...EDITOR_PROPS}
						initialTab="versions"
						versionHistoryPanel={
							<AgentVersionHistoryPanel
								currentValue={currentSource}
								onRestored={() =>
									setStatus((value) => `${value} · ready to test`)
								}
								source={versionSource}
							/>
						}
					/>

					<div className="mt-6 rounded-xl border bg-muted/20 p-4">
						<div className="flex items-center justify-between gap-3">
							<p className="font-medium text-sm">Current saved definition</p>
							<Button
								onClick={() => setStatus("Ready to run Quality tests")}
								size="sm"
								variant="ghost"
							>
								Mark ready to test
							</Button>
						</div>
						<pre
							className="mt-3 overflow-auto rounded-lg bg-background p-3 font-mono text-xs"
							data-testid="current-config"
						>
							{currentSource}
						</pre>
					</div>
				</section>

				<p className="text-muted-foreground text-xs" data-testid="proof-status">
					Full agent definition · snapshot, diff, restore
				</p>
			</div>
		</main>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<AgentVersionHistoryProof />
);
