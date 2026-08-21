import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Markdown } from "../../components/agent-elements/markdown.tsx";
import type { MentionItem as TranscriptMentionItem } from "../../components/agent-elements/types.ts";
import { MentionMenu } from "../../src/components/chat/MentionMenu.tsx";
import {
	buildComposioMentionSources,
	buildMentionGroups,
} from "../../src/lib/mentions/candidates.ts";
import type {
	MentionItem,
	MentionSources,
} from "../../src/lib/mentions/types.ts";
import "../../src/index.css";

const CONNECTIONS = [
	{ active: true, toolkit: "github" },
	{ active: false, toolkit: "slack" },
];

const TOOLKITS = [
	{
		description: "Issues and repositories",
		name: "GitHub",
		slug: "github",
	},
	{ description: "Messages and channels", name: "Slack", slug: "slack" },
];

const PROOF_APP_ICON = (color: string, label: string) => (
	<span
		aria-label={`${label} app icon`}
		className="size-3.5 shrink-0 rounded-[4px]"
		style={{ backgroundColor: color }}
	/>
);

const TRANSCRIPT_MENTIONS: TranscriptMentionItem[] = [
	{ id: "claude", kind: "agent", label: "Claude Code" },
	{
		accentColor: "#6366f1",
		id: "browser",
		kind: "app",
		label: "Browser",
		visualIcon: PROOF_APP_ICON("#6366f1", "Browser"),
	},
	{
		accentColor: "#f59e0b",
		id: "com.ryu.canvas:canvas:brief",
		kind: "app-item",
		label: "Design brief",
		target: { path: "/spaces/space-1/app/canvas/brief" },
		visualIcon: PROOF_APP_ICON("#f59e0b", "Canvas"),
	},
	{ id: "architecture", kind: "chat", label: "Architecture notes" },
	{ id: "platform", kind: "team", label: "Platform team" },
	{ id: "deploy", kind: "workflow", label: "Build and deploy" },
	{ id: "personal", kind: "space", label: "Personal space" },
	{
		id: "space-1:launch-plan",
		kind: "page",
		label: "Launch plan",
		target: { path: "/spaces/space-1/doc/launch-plan" },
	},
	{
		id: "plain",
		kind: "output-style",
		label: "Plain text",
		target: { path: "/settings" },
	},
	{ id: "research", kind: "skill", label: "Research" },
	{ id: "local-mcp", kind: "mcp", label: "Local MCP" },
	{ id: "/workspace/ryu-closed", kind: "folder", label: "ryu-closed" },
	{ id: "github", kind: "integration", label: "GitHub" },
	{
		accentColor: "#ec4899",
		id: "double-check",
		kind: "plugin",
		label: "Double-check",
		visualIcon: PROOF_APP_ICON("#ec4899", "Double-check"),
	},
];

const TRANSCRIPT_MENTION_TEXT = TRANSCRIPT_MENTIONS.map(
	(item) => `@${item.label}`
).join(" ");

function TranscriptMentionProof() {
	const [opened, setOpened] = useState<string[]>([]);
	const record = (role: "user" | "agent", item: TranscriptMentionItem) => {
		setOpened((current) =>
			current.includes(`${role}:${item.kind}:${item.id}`)
				? current
				: [...current, `${role}:${item.kind}:${item.id}`]
		);
	};
	const recordWebsite = (role: "user" | "agent", url: string) => {
		setOpened((current) =>
			current.includes(`${role}:website:${url}`)
				? current
				: [...current, `${role}:website:${url}`]
		);
	};
	const expected = TRANSCRIPT_MENTIONS.flatMap((item) => [
		`user:${item.kind}:${item.id}`,
		`agent:${item.kind}:${item.id}`,
	]);
	const expectedLinks = [
		"user:website:https://example.com/mention-proof",
		"agent:website:https://example.com/mention-proof",
	];
	const isVerified = [...expected, ...expectedLinks].every((key) =>
		opened.includes(key)
	);

	return (
		<section
			aria-label="Transcript mention link proof"
			className="mt-6 rounded-3xl border border-indigo-300/20 bg-indigo-300/[0.06] p-5 shadow-2xl"
			data-testid="transcript-mention-proof"
		>
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<p className="font-semibold text-white text-xl">
						Transcript destinations
					</p>
					<p className="mt-1 max-w-3xl text-slate-400 text-sm">
						The same Markdown renderer is mounted in a user bubble and an agent
						bubble. Every resolved entity mention and website link below must
						open through its role-specific callback.
					</p>
				</div>
				<div
					className={`rounded-full px-3 py-1 font-semibold text-xs ${isVerified ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-200"}`}
					data-testid="transcript-proof-status"
				>
					{isVerified
						? "VERIFIED · all destinations opened"
						: `${opened.length}/${expected.length + expectedLinks.length} opened`}
				</div>
			</div>

			<div className="mt-5 grid gap-4 lg:grid-cols-2">
				<div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
					<p className="mb-2 font-semibold text-indigo-200 text-xs uppercase tracking-[0.16em]">
						User message
					</p>
					<div data-testid="user-transcript-markdown">
						<Markdown
							content={`${TRANSCRIPT_MENTION_TEXT} [Open website](https://example.com/mention-proof)`}
							mentionItems={TRANSCRIPT_MENTIONS}
							onOpenLink={(url) => recordWebsite("user", url)}
							onOpenMention={(item) => record("user", item)}
						/>
					</div>
				</div>
				<div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
					<p className="mb-2 font-semibold text-indigo-200 text-xs uppercase tracking-[0.16em]">
						Agent message
					</p>
					<div data-testid="agent-transcript-markdown">
						<Markdown
							content={`${TRANSCRIPT_MENTION_TEXT} [Open website](https://example.com/mention-proof)`}
							mentionItems={TRANSCRIPT_MENTIONS}
							onOpenLink={(url) => recordWebsite("agent", url)}
							onOpenMention={(item) => record("agent", item)}
						/>
					</div>
				</div>
			</div>

			<p
				className="mt-4 text-slate-500 text-xs"
				data-testid="transcript-proof-log"
			>
				{opened.length > 0
					? `Opened: ${opened.join(" · ")}`
					: "Click every @ mention and website link in both bubbles to complete the proof."}
			</p>
		</section>
	);
}

function sources(configured: boolean): MentionSources {
	return {
		agents: [{ id: "claude", name: "Claude Code" }],
		apps: [
			{
				accentColor: "#6366f1",
				description: "Installed companion app",
				id: "browser",
				name: "Browser",
				visualIcon: PROOF_APP_ICON("#6366f1", "Browser"),
			},
		],
		appItems: [
			{
				accentColor: "#f59e0b",
				description: "Canvas · document",
				id: "com.ryu.canvas:canvas:brief",
				name: "Design brief",
				target: { path: "/spaces/space-1/app/canvas/brief" },
				visualIcon: PROOF_APP_ICON("#f59e0b", "Canvas"),
			},
		],
		chats: [],
		folders: [],
		integrations: buildComposioMentionSources(
			configured,
			CONNECTIONS,
			TOOLKITS
		),
		mcp: [],
		plugins: [
			{
				accentColor: "#ec4899",
				description: "Installed composer extension",
				id: "double-check",
				name: "Double-check",
				visualIcon: PROOF_APP_ICON("#ec4899", "Double-check"),
			},
		],
		skills: [{ id: "research", name: "Research" }],
		spaces: [],
		pages: [
			{
				description: "Personal space · Page",
				id: "space-1:launch-plan",
				name: "Launch plan",
				target: { path: "/spaces/space-1/doc/launch-plan" },
			},
		],
		outputStyles: [
			{
				description: "Short and direct",
				id: "plain",
				name: "Plain text",
				target: { path: "/settings" },
			},
		],
		teams: [],
		workflows: [],
	};
}

function MentionState({
	configured,
	label,
}: {
	configured: boolean;
	label: string;
}) {
	const anchorRef = useRef<HTMLTextAreaElement | null>(null);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const mentionSources = useMemo(() => sources(configured), [configured]);
	const groups = useMemo(
		() => buildMentionGroups(mentionSources, query),
		[mentionSources, query]
	);

	const handleSelect = (item: MentionItem) => {
		setSelected(`@${item.label}`);
	};

	return (
		<section
			aria-label={label}
			className="flex min-h-[34rem] flex-1 flex-col rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl"
			data-configured={configured}
			data-testid={configured ? "configured-state" : "unconfigured-state"}
		>
			<div className="mb-4 flex items-start justify-between gap-4">
				<div>
					<p className="font-semibold text-white text-xl">{label}</p>
					<p className="mt-1 text-slate-400 text-sm">
						{configured
							? "BYOK or managed subscription/proxy is available"
							: "No Composio credential is available on this node"}
					</p>
					{selected ? (
						<p
							className="mt-2 font-medium text-indigo-200 text-sm"
							data-testid={`${configured ? "configured" : "unconfigured"}-header-selection`}
						>
							Selected {selected}
						</p>
					) : null}
				</div>
				<span
					className={`rounded-full px-3 py-1 font-semibold text-xs ${configured ? "bg-emerald-400/15 text-emerald-300" : "bg-slate-400/10 text-slate-400"}`}
				>
					{configured ? "CONNECTED" : "HIDDEN"}
				</span>
			</div>

			<div className="relative flex-1">
				<textarea
					aria-label={`${label} composer`}
					className="min-h-14 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-200 outline-none ring-indigo-300/50 placeholder:text-slate-600 focus:ring-2"
					onChange={(event) => setQuery(event.target.value.replace(/^@/, ""))}
					placeholder="Type @ to mention…"
					ref={anchorRef}
					value={`@${query}`}
				/>
				<div className="absolute top-[29rem] left-0 w-full">
					<MentionMenu
						anchorRef={anchorRef}
						groups={groups}
						onDismiss={() => undefined}
						onSelect={handleSelect}
					/>
				</div>
			</div>

			<div className="mt-4 min-h-10 rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-sm">
				<span className="text-slate-500">Selected mention: </span>
				<strong
					className="text-indigo-200"
					data-testid={`${configured ? "configured" : "unconfigured"}-selection`}
				>
					{selected ?? "none"}
				</strong>
			</div>
		</section>
	);
}

function MentionComposerProof() {
	const configuredGroups = buildMentionGroups(sources(true), "");
	const unconfiguredGroups = buildMentionGroups(sources(false), "");
	const configuredLabels = configuredGroups.map((group) => group.label);
	const unconfiguredLabels = unconfiguredGroups.map((group) => group.label);
	const hasExpectedGroups = [
		"Agents",
		"Apps",
		"App items",
		"Integrations",
		"Plugins",
		"Skills",
		"Space pages",
		"Output styles",
	].every((group) => configuredLabels.includes(group));
	const integrationHidden = !unconfiguredLabels.includes("Integrations");

	return (
		<main className="min-h-screen bg-[#0b1020] px-6 py-10 text-slate-200">
			<div className="mx-auto max-w-6xl">
				<div className="mb-8 flex flex-wrap items-end justify-between gap-5">
					<div>
						<p className="font-medium text-indigo-300 text-sm uppercase tracking-[0.2em]">
							React verification artifact
						</p>
						<h1 className="mt-2 font-semibold text-4xl text-white tracking-tight">
							Mention directory
						</h1>
						<p className="mt-3 max-w-2xl text-slate-400">
							Agents, installed apps and their list items, Space pages, output
							styles, plugins, skills, and connected integrations share one
							searchable @ menu. Composio integrations are fail-closed until the
							active node reports BYOK or managed subscription/proxy access.
						</p>
					</div>
					<div
						className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-3 text-right"
						data-testid="proof-status"
					>
						<p className="font-semibold text-emerald-300 text-lg">
							{hasExpectedGroups && integrationHidden
								? "VERIFIED"
								: "CHECK FAILED"}
						</p>
						<p className="mt-1 text-emerald-200/70 text-xs">
							{configuredLabels.length} visible groups · gated integration
						</p>
					</div>
				</div>

				<div className="grid gap-6 lg:grid-cols-2">
					<MentionState configured label="Credential available" />
					<MentionState configured={false} label="Credential unavailable" />
				</div>
				<TranscriptMentionProof />
			</div>
		</main>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<MentionComposerProof />
);
