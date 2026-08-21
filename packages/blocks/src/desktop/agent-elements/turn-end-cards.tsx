import {
	ArrowDown01Icon,
	ArrowUpRight01Icon,
	FileCodeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button";
import { formatCount } from "@ryu/ui/lib/number-format.ts";
import { cn } from "@ryu/ui/lib/utils";
import { useState } from "react";
import { AgentUI } from "./agent-ui/agent-ui.tsx";
import { useArtifactHost } from "./artifact-host-context.tsx";
import { FileTypeIcon } from "./file-type-icon.tsx";
import type {
	ArtifactTurnEndCard,
	EditedFile,
	FileEditsTurnEndCard,
	JsonRenderTurnEndCard,
	TurnEndCard,
} from "./turn-end-cards.ts";

const MAX_COLLAPSED_FILES = 3;

function countLabel(value: number): string {
	return formatCount(value) ?? "0";
}

function EditStats({ file }: { file: EditedFile }) {
	return (
		<span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
			{file.insertions > 0 ? (
				<span className="text-emerald-500">+{countLabel(file.insertions)}</span>
			) : null}
			{file.deletions > 0 ? (
				<span className="text-rose-500">-{countLabel(file.deletions)}</span>
			) : null}
		</span>
	);
}

function FileEditsCard({
	card,
	onOpenFile,
}: {
	card: FileEditsTurnEndCard;
	onOpenFile?: (path: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const files = expanded
		? card.files
		: card.files.slice(0, MAX_COLLAPSED_FILES);
	const remaining = card.files.length - files.length;
	const totalInsertions = card.files.reduce(
		(total, file) => total + file.insertions,
		0
	);
	const totalDeletions = card.files.reduce(
		(total, file) => total + file.deletions,
		0
	);
	const firstFile = card.files[0];

	return (
		<section
			className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm"
			data-slot="turn-file-edits-card"
		>
			<header className="flex items-center gap-3 px-4 py-3">
				<span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground shadow-xs ring-1 ring-border/60">
					<HugeiconsIcon aria-hidden className="size-6" icon={FileCodeIcon} />
				</span>
				<div className="min-w-0">
					<h3 className="font-medium text-base leading-tight">
						Edited {countLabel(card.files.length)}{" "}
						{card.files.length === 1 ? "file" : "files"}
					</h3>
					<div className="mt-1 flex items-center gap-2 font-mono text-sm tabular-nums">
						<span className="text-emerald-500">
							+{countLabel(totalInsertions)}
						</span>
						<span className="text-rose-500">-{countLabel(totalDeletions)}</span>
					</div>
				</div>
				{onOpenFile && firstFile ? (
					<Button
						className="ml-auto shrink-0"
						onClick={() => onOpenFile(firstFile.path)}
						size="sm"
						type="button"
						variant="outline"
					>
						Review
						<HugeiconsIcon
							aria-hidden
							className="size-3.5"
							icon={ArrowUpRight01Icon}
						/>
					</Button>
				) : null}
			</header>
			<div className="border-border/70 border-t">
				{files.map((file) => (
					<button
						className="flex w-full items-center gap-3 border-border/50 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
						key={file.path}
						onClick={() => onOpenFile?.(file.path)}
						type="button"
					>
						<FileTypeIcon className="size-4" path={file.path} />
						<span
							className="min-w-0 flex-1 truncate font-mono text-sm"
							title={file.path}
						>
							{file.path}
						</span>
						<EditStats file={file} />
					</button>
				))}
				{remaining > 0 ? (
					<button
						aria-expanded={expanded}
						className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
						onClick={() => setExpanded(true)}
						type="button"
					>
						<span>
							Show {countLabel(remaining)} more{" "}
							{remaining === 1 ? "file" : "files"}
						</span>
						<HugeiconsIcon
							aria-hidden
							className="size-4"
							icon={ArrowDown01Icon}
						/>
					</button>
				) : expanded && card.files.length > MAX_COLLAPSED_FILES ? (
					<button
						aria-expanded={expanded}
						className="flex w-full items-center gap-2 px-4 py-3 text-left text-muted-foreground text-sm transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
						onClick={() => setExpanded(false)}
						type="button"
					>
						<span>Show fewer files</span>
						<HugeiconsIcon
							aria-hidden
							className="size-4 rotate-180"
							icon={ArrowDown01Icon}
						/>
					</button>
				) : null}
			</div>
		</section>
	);
}

function JsonRenderCard({
	card,
	onSubmit,
}: {
	card: JsonRenderTurnEndCard;
	onSubmit?: (value: unknown) => void | Promise<void>;
}) {
	return (
		<section
			className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm"
			data-slot="turn-json-render-card"
		>
			<header className="flex items-center gap-2 border-border/70 border-b px-4 py-3">
				<span className="rounded-lg bg-primary/10 px-2 py-1 font-mono text-[10px] text-primary uppercase tracking-[0.12em]">
					{card.format === "a2ui" ? "A2UI" : "JSON UI"}
				</span>
				{card.title ? (
					<h3 className="min-w-0 truncate font-medium text-sm">{card.title}</h3>
				) : null}
			</header>
			<div className="p-3">
				<AgentUI format={card.format} onSubmit={onSubmit} spec={card.spec} />
			</div>
		</section>
	);
}

function safeArtifactUrl(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	try {
		const url = new URL(value, "http://localhost");
		return url.protocol === "http:" || url.protocol === "https:"
			? url.toString()
			: undefined;
	} catch {
		return undefined;
	}
}

function ArtifactCard({ card }: { card: ArtifactTurnEndCard }) {
	const host = useArtifactHost();
	if (host) {
		const Renderer = host.Renderer;
		return (
			<div className="w-full" data-slot="turn-artifact-card">
				<Renderer artifact={card.artifact} id={card.id} />
			</div>
		);
	}
	const url = safeArtifactUrl(card.artifact.url);
	return (
		<section
			className="flex items-center gap-3 rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-sm"
			data-slot="turn-artifact-card"
		>
			<HugeiconsIcon
				aria-hidden
				className="size-5 shrink-0 text-muted-foreground"
				icon={FileCodeIcon}
			/>
			<span className="min-w-0 flex-1 truncate font-medium text-sm">
				{card.artifact.title ?? "Artifact"}
			</span>
			{url ? (
				<a
					className={cn(
						"inline-flex shrink-0 items-center gap-1 text-primary text-sm hover:underline"
					)}
					href={url}
					rel="noopener noreferrer"
					target="_blank"
				>
					Open
					<HugeiconsIcon
						aria-hidden
						className="size-3.5"
						icon={ArrowUpRight01Icon}
					/>
				</a>
			) : null}
		</section>
	);
}

export function TurnEndCards({
	cards,
	onAgentUiSubmit,
	onOpenFile,
}: {
	cards: TurnEndCard[];
	onAgentUiSubmit?: (value: unknown) => void | Promise<void>;
	onOpenFile?: (path: string) => void;
}) {
	if (cards.length === 0) {
		return null;
	}
	return (
		<div
			className="flex w-full max-w-full flex-col gap-3"
			data-slot="turn-end-cards"
		>
			{cards.map((card) => {
				if (card.kind === "file-edits") {
					return (
						<FileEditsCard card={card} key={card.id} onOpenFile={onOpenFile} />
					);
				}
				if (card.kind === "json-render") {
					return (
						<JsonRenderCard
							card={card}
							key={card.id}
							onSubmit={onAgentUiSubmit}
						/>
					);
				}
				return <ArtifactCard card={card} key={card.id} />;
			})}
		</div>
	);
}
