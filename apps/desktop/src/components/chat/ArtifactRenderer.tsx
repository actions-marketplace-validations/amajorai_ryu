// apps/desktop/src/components/chat/ArtifactRenderer.tsx
//
// Draws an artifact (see lib/artifacts.ts) in a full-size surface — the right
// dock's artifact tab and the window-tab artifact page. HTML/SVG/mermaid render
// inside a STRICT sandboxed iframe; code/file show a read-only view; space
// renders as markdown; database renders as a table. Also renders approval-style
// artifact actions with the app's own ToolApproval primitive (the same component
// the permission prompts use).
//
// `ArtifactContentView` is the shared body — the inline chat card
// (InlineArtifact.tsx) mounts it at a smaller fixed height.
//
// SECURITY POSTURE — modelled on PluginHostPanel / ExtensionHost (do not weaken):
//   - The frame is `sandbox="allow-scripts"` WITHOUT `allow-same-origin`, so it
//     runs at a NULL origin: no parent DOM, no cookies/storage, no Tauri IPC.
//   - A per-document CSP (`connect-src 'none'`, `default-src 'none'`) blocks all
//     network egress, so a poisoned artifact cannot beacon/exfiltrate or pull a
//     remote payload. Only inline script/style and data: media run.
//   - Rendering is fully guarded: a bad artifact shows an inline error, never
//     throws into the chat tree (the iframe isolates HTML/SVG faults; mermaid
//     compilation is try/caught).

import {
	AlertCircleIcon,
	BrowserIcon,
	DatabaseIcon,
	File01Icon,
	Flowchart01Icon,
	FolderOpenIcon,
	Image02Icon,
	SourceCodeIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { useArtifactHost } from "@ryu/blocks/desktop/agent-elements/artifact-host-context.tsx";
import { Markdown } from "@ryu/blocks/desktop/agent-elements/markdown.tsx";
import {
	ToolApprovalActions,
	type ToolApprovalChoice,
} from "@ryu/ui/components/agents/tool-approval";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ryu/ui/components/table";
import { cn } from "@ryu/ui/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { useAppSurface } from "@/src/contexts/app-surface-context.tsx";
import { artifactSrcDoc } from "@/src/lib/artifact-srcdoc.ts";
import {
	type Artifact,
	type ArtifactAction,
	type ArtifactKind,
	parseTabularContent,
} from "@/src/lib/artifacts.ts";

const MERMAID_ID_UNSAFE_RE = /[^a-zA-Z0-9_-]/g;

/** Compile mermaid DSL → SVG string. Imported lazily so mermaid (large) stays
 *  off the main bundle and only loads when an artifact needs it. */
async function compileMermaid(id: string, code: string): Promise<string> {
	const mermaidModule = await import("mermaid");
	const mermaid = mermaidModule.default;
	const prefersDark =
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-color-scheme: dark)").matches;
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		theme: prefersDark ? "dark" : "default",
	});
	const safeId = `artifact-mermaid-${id.replace(MERMAID_ID_UNSAFE_RE, "")}`;
	const { svg } = await mermaid.render(safeId, code);
	return svg;
}

export const KIND_ICON: Record<ArtifactKind, IconSvgElement> = {
	html: BrowserIcon,
	svg: Image02Icon,
	mermaid: Flowchart01Icon,
	code: SourceCodeIcon,
	file: File01Icon,
	space: FolderOpenIcon,
	database: DatabaseIcon,
};

export const KIND_LABEL: Record<ArtifactKind, string> = {
	html: "Page",
	svg: "SVG",
	mermaid: "Diagram",
	code: "Code",
	file: "File",
	space: "Space",
	database: "Database",
};

function ArtifactFrame({ doc, title }: { doc: string; title: string }) {
	return (
		<iframe
			// allow-scripts WITHOUT allow-same-origin → null origin, no Tauri IPC,
			// no parent DOM. The doc's CSP blocks all network egress.
			className="h-full w-full border-0 bg-background"
			referrerPolicy="no-referrer"
			sandbox="allow-scripts"
			srcDoc={doc}
			title={title}
		/>
	);
}

function ArtifactError({ message }: { message: string }) {
	return (
		<div className="flex h-full items-center justify-center p-6">
			<div className="flex max-w-sm items-start gap-2 text-destructive text-xs">
				<HugeiconsIcon
					aria-hidden
					className="mt-0.5 size-4 shrink-0"
					icon={AlertCircleIcon}
				/>
				<span className="whitespace-pre-wrap break-words">{message}</span>
			</div>
		</div>
	);
}

/** Read-only code/file view (the artifact body for `code`/`file` kinds). */
function CodeView({ artifact }: { artifact: Artifact }) {
	return (
		<div className="h-full overflow-auto bg-sidebar">
			<pre className="p-3 font-mono text-[12.5px] text-foreground leading-[1.55]">
				<code>{artifact.content}</code>
			</pre>
		</div>
	);
}

/** A `file` artifact whose content isn't inline (e.g. a binary or a created file
 *  that hasn't been fetched): a friendly placeholder instead of an empty code box.
 *  The header's "Open in editor" and the card's Open affordances still reach it. */
function FilePlaceholder({ artifact }: { artifact: Artifact }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 bg-sidebar p-6">
			<HugeiconsIcon
				aria-hidden
				className="size-8 text-muted-foreground/60"
				icon={File01Icon}
			/>
			<span className="max-w-xs text-center text-muted-foreground text-xs">
				{artifact.title || "File"} — open it in the side panel or as a tab to
				view it.
			</span>
		</div>
	);
}

/** A `database` artifact rendered as a table; falls back to the code view when
 *  the content isn't tabular. */
function DatabaseView({ artifact }: { artifact: Artifact }) {
	const table = useMemo(
		() => parseTabularContent(artifact.content),
		[artifact.content]
	);
	if (!table) {
		return <CodeView artifact={artifact} />;
	}
	return (
		<div className="h-full overflow-auto bg-sidebar">
			<div className="p-3">
				<div className="overflow-x-auto rounded-[var(--radius)] border border-border">
					<Table>
						<TableHeader>
							<TableRow>
								{table.columns.map((col) => (
									<TableHead key={col}>{col}</TableHead>
								))}
							</TableRow>
						</TableHeader>
						<TableBody>
							{table.rows.map((row, rowIndex) => (
								<TableRow key={rowIndex}>
									{row.map((cell, cellIndex) => (
										<TableCell key={cellIndex}>{cell}</TableCell>
									))}
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			</div>
		</div>
	);
}

function MermaidBody({ artifact }: { artifact: Artifact }) {
	const [mermaidDoc, setMermaidDoc] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (artifact.kind !== "mermaid") {
			return;
		}
		let cancelled = false;
		setMermaidDoc(null);
		setError(null);
		compileMermaid(artifact.id, artifact.content)
			.then((svg) => {
				if (!cancelled) {
					setMermaidDoc(artifactSrcDoc("svg", svg));
				}
			})
			.catch((err: unknown) => {
				if (!cancelled) {
					setError(
						err instanceof Error ? err.message : "Failed to render diagram"
					);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [artifact.id, artifact.kind, artifact.content]);

	if (error) {
		return <ArtifactError message={error} />;
	}
	if (!mermaidDoc) {
		return (
			<div className="flex h-full animate-pulse items-center justify-center text-muted-foreground text-xs">
				Rendering diagram…
			</div>
		);
	}
	return <ArtifactFrame doc={mermaidDoc} title={artifact.title} />;
}

/**
 * The artifact BODY — everything below the header row. Shared by the full-size
 * `ArtifactRenderer`, the inline chat card and the window-tab page. Fills its
 * parent's height (`h-full`).
 */
export function ArtifactContentView({ artifact }: { artifact: Artifact }) {
	const syncDoc = useMemo(
		() => artifactSrcDoc(artifact.kind, artifact.content),
		[artifact.kind, artifact.content]
	);

	if (artifact.kind === "code") {
		return <CodeView artifact={artifact} />;
	}
	if (artifact.kind === "file") {
		return artifact.content.trim() ? (
			<CodeView artifact={artifact} />
		) : (
			<FilePlaceholder artifact={artifact} />
		);
	}
	if (artifact.kind === "database") {
		return <DatabaseView artifact={artifact} />;
	}
	if (artifact.kind === "space") {
		return (
			<div className="h-full overflow-auto bg-sidebar">
				<div className="p-4">
					<Markdown
						className="prose-sm"
						content={artifact.content}
						textContrast="high"
					/>
				</div>
			</div>
		);
	}
	if (artifact.kind === "mermaid") {
		return <MermaidBody artifact={artifact} />;
	}
	if (!syncDoc) {
		return <ArtifactError message="This artifact cannot be rendered." />;
	}
	return <ArtifactFrame doc={syncDoc} title={artifact.title} />;
}

/** Map an artifact action to a ToolApproval choice, wired to the host's
 *  follow-up so the user's pick becomes the agent's next prompt. */
function actionChoices(
	actions: ArtifactAction[] | undefined,
	submit: (text: string) => void
): ToolApprovalChoice[] | undefined {
	if (!actions || actions.length === 0) {
		return undefined;
	}
	return actions.map((action) => ({
		id: action.id,
		label: action.label,
		tone: action.tone,
		onSelect: () => submit(action.label),
	}));
}

/** The shared artifact header: kind glyph + title + badge, then (right-aligned)
 *  an approval-style action row and a file's "Open in editor" button. */
export function ArtifactHeader({
	artifact,
	compact,
	onOpenInEditor,
	onAction,
}: {
	artifact: Artifact;
	compact?: boolean;
	onOpenInEditor?: (filePath: string) => void;
	onAction?: (action: ArtifactAction) => void;
}) {
	const { canUseNativeShell } = useAppSurface();
	const host = useArtifactHost();
	const submit =
		onAction ??
		((action: ArtifactAction) => host?.submitFollowUp(action.label));
	const choices = actionChoices(artifact.actions, (text) => {
		const action = artifact.actions?.find((a) => a.label === text);
		if (action) {
			submit(action);
		}
	});
	const defaultOpenInEditor =
		artifact.kind === "file" && artifact.filePath
			? (path: string) => {
					Promise.resolve(
						invoke("open_in_editor", { editor: "vscode", path })
					).catch(() => {
						/* the artifact stays viewable; nothing else to do */
					});
				}
			: undefined;
	const openInEditor = canUseNativeShell
		? (onOpenInEditor ?? defaultOpenInEditor)
		: undefined;

	return (
		<div
			className={cn(
				"flex shrink-0 items-center gap-2 border-border/60 border-b px-3",
				compact ? "py-1.5" : "py-2"
			)}
		>
			<HugeiconsIcon
				aria-hidden
				className="size-4 shrink-0 text-muted-foreground"
				icon={KIND_ICON[artifact.kind]}
			/>
			<span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm">
				{artifact.title}
			</span>
			{artifact.kind === "file" && openInEditor && artifact.filePath ? (
				<button
					className="shrink-0 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					onClick={() => openInEditor(artifact.filePath as string)}
					type="button"
				>
					Open in editor
				</button>
			) : null}
			<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
				{KIND_LABEL[artifact.kind]}
			</span>
			{choices && choices.length > 0 ? (
				<ToolApprovalActions choices={choices} status="pending" />
			) : null}
		</div>
	);
}

export function ArtifactRenderer({ artifact }: { artifact: Artifact }) {
	const host = useArtifactHost();
	const [fetchedContent, setFetchedContent] = useState<string | null>(null);

	// A created artifact (`url` set, no inline content) is fetched lazily through
	// the host's node target; the window-tab page pre-resolves content on open, so
	// this only fires for e.g. a dock tab opened from the cowork panel.
	useEffect(() => {
		if (!artifact.url || artifact.content) {
			setFetchedContent(null);
			return;
		}
		let cancelled = false;
		host
			?.fetchContent(
				{
					url: artifact.url,
					mime: artifact.mime,
					title: artifact.title,
				},
				artifact.id
			)
			.then((content) => {
				if (!cancelled) {
					setFetchedContent(content);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [
		host,
		artifact.id,
		artifact.url,
		artifact.mime,
		artifact.title,
		artifact.content,
	]);

	const resolved: Artifact =
		fetchedContent === null
			? artifact
			: { ...artifact, content: fetchedContent };

	return (
		<div className="flex h-full flex-col">
			<ArtifactHeader artifact={artifact} />
			{/* Keyed on id so switching artifacts remounts the frame/compile cleanly. */}
			<div className="min-h-0 flex-1 overflow-hidden" key={artifact.id}>
				<ArtifactContentView artifact={resolved} />
			</div>
		</div>
	);
}
