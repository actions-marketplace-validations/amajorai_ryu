"use client";

import { cn } from "@ryu/ui/lib/utils";
import { createCodePlugin } from "@streamdown/code";
import { type Components, Streamdown } from "streamdown";
import "streamdown/styles.css";
import { ExpandIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog.tsx";
import { type ReactNode, type TableHTMLAttributes, useState } from "react";
import { useChatDisplayPrefs } from "./chat-display-prefs.tsx";
import { FileTypeIcon } from "./file-type-icon.tsx";
import { type Citation, CitationMarkLink } from "./inline-citation.tsx";
import { LinkPreview, type LinkPreviewResolvers } from "./link-preview.tsx";
import { decodeMentionHref, linkifyAtMentions } from "./linkify-mentions.ts";
import { formatMentionContent } from "./mention-format.ts";
import { MentionToken } from "./mention-token.tsx";
import type { MentionItem } from "./types.ts";
import { linkifyCitationMarkers } from "./utils/citations.ts";

// Fixed streaming-animation treatment (Streamdown's animate plugin). Word-by-word
// blur-in is the softest of the built-ins; the toggle lives upstream (settings),
// so the config here is a constant, not a lock.
const STREAM_ANIMATION = {
	animation: "blurIn",
	duration: 200,
	sep: "word",
} as const;

function fixNumberedListBreaks(text: string): string {
	return text.replace(/^(\d+)\.\s*\n+\s*\n*/gm, "$1. ");
}

const CODE_FENCE_LANGS = new Set([
	"bash",
	"diff",
	"html",
	"js",
	"json",
	"jsx",
	"md",
	"markdown",
	"sh",
	"shell",
	"text",
	"ts",
	"tsx",
	"yml",
	"yaml",
]);
const CODE_FENCE_SPLIT_RE = /(```[\s\S]*?```)/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const LEADING_DOT_SLASH_RE = /^\.?\//;

function normalizeCodeFenceLanguages(text: string): string {
	return text.replace(/```([^\n]*)/g, (_match, langRaw) => {
		const lang = String(langRaw || "")
			.trim()
			.toLowerCase();
		if (!lang) {
			return "```";
		}
		const normalized = lang.split(/\s+/)[0];
		return CODE_FENCE_LANGS.has(normalized) ? `\`\`\`${normalized}` : "```text";
	});
}

export interface MarkdownProps {
	/** Web-tool citations for this turn; bare `[n]` markers become inline chips. */
	citations?: Citation[];
	className?: string;
	content: string;
	fileReferences?: FileReference[];
	/**
	 * When true, newly streamed text animates in (word-by-word blur-in). Callers
	 * pass the already-resolved value: only the actively streaming last assistant
	 * turn with animations enabled should set this. Omitted/false ⇒ static render
	 * (past messages, other surfaces, motion disabled). Default: false.
	 */
	isAnimating?: boolean;
	mentionItems?: MentionItem[];
	onOpenFile?: (path: string) => void;
	onOpenLink?: (url: string) => void;
	onOpenMention?: (item: MentionItem) => void;
	previewResolvers?: LinkPreviewResolvers;
	textContrast?: "normal" | "high";
}

export interface FileReference {
	label: string;
	path: string;
}

const code = createCodePlugin({
	themes: ["github-light", "github-dark"],
});

function normalizePathToken(value: string): string {
	return value.replaceAll("\\", "/").replace(LEADING_DOT_SLASH_RE, "");
}

function findFileReference(
	value: string,
	fileReferences: FileReference[] | undefined
): FileReference | null {
	if (!fileReferences?.length) {
		return null;
	}
	const normalized = normalizePathToken(value);
	return (
		fileReferences.find((ref) => {
			const refPath = normalizePathToken(ref.path);
			const refLabel = normalizePathToken(ref.label);
			return (
				normalized === refPath ||
				normalized === refLabel ||
				refPath.endsWith(`/${normalized}`)
			);
		}) ?? null
	);
}

function escapeMarkdownLinkText(value: string): string {
	return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function enrichInlineFileReferences(
	text: string,
	fileReferences: FileReference[] | undefined
): string {
	if (!fileReferences?.length) {
		return text;
	}
	return text
		.split(CODE_FENCE_SPLIT_RE)
		.map((segment) => {
			if (segment.startsWith("```")) {
				return segment;
			}
			return segment.replace(INLINE_CODE_RE, (match, rawLabel: string) => {
				const ref = findFileReference(rawLabel, fileReferences);
				if (!ref) {
					return match;
				}
				const index = fileReferences.indexOf(ref);
				return `[\`${escapeMarkdownLinkText(rawLabel)}\`](#ryu-file-${index})`;
			});
		})
		.join("");
}

function decodeMentionLabel(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function ExpandableMarkdownTable({
	children,
	className,
	...props
}: TableHTMLAttributes<HTMLTableElement> & { children?: ReactNode }) {
	const [open, setOpen] = useState(false);
	const tableClassName = cn(
		"an-md-table w-full min-w-max text-sm [&>thead>tr>th]:bg-muted [&>thead]:bg-muted",
		className
	);

	const table = (extraClassName?: string) => (
		<table className={cn(tableClassName, extraClassName)} {...props}>
			{children}
		</table>
	);

	return (
		<>
			<div className="group/an-md-table relative my-3">
				<div className="scroll-fade-x overflow-x-auto rounded-[var(--radius)]">
					{table()}
				</div>
				<Button
					aria-label="Expand table"
					className="absolute top-1 right-1 z-10 size-7 bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 group-hover/an-md-table:opacity-100"
					data-testid="markdown-table-expand"
					onClick={() => setOpen(true)}
					size="icon-xs"
					title="Expand table"
					variant="ghost"
				>
					<HugeiconsIcon icon={ExpandIcon} size={14} />
				</Button>
			</div>
			<Dialog onOpenChange={setOpen} open={open}>
				<DialogContent className="flex max-h-[min(90vh,60rem)] max-w-[min(95vw,90rem)] flex-col gap-3">
					<DialogHeader>
						<DialogTitle>Expanded markdown table</DialogTitle>
						<DialogDescription>
							Scroll horizontally or vertically to inspect the full table.
						</DialogDescription>
					</DialogHeader>
					<div className="min-h-0 overflow-auto rounded-[var(--radius)] border border-border/60">
						{table("min-w-[72rem]")}
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

export function Markdown({
	mentionItems,
	citations,
	content,
	className,
	fileReferences,
	isAnimating = false,
	onOpenFile,
	onOpenLink,
	onOpenMention,
	previewResolvers,
}: MarkdownProps) {
	// Code blocks obey the same "Tool detail" level as tool calls: at anything
	// below Detailed a long block is capped and scrolls in place. The switch is a
	// data attribute rather than a prop on the code plugin because the fenced
	// block is rendered by `@streamdown/code`, not by a component we own — the
	// cap lands in CSS against its stable `data-streamdown` parts (agent-ui.css).
	const { expandCodeBlocks } = useChatDisplayPrefs();
	const mentionContent = formatMentionContent(content, mentionItems);
	const safeContent = normalizeCodeFenceLanguages(
		fixNumberedListBreaks(
			linkifyCitationMarkers(
				linkifyAtMentions(
					enrichInlineFileReferences(mentionContent, fileReferences)
				),
				citations
			)
		)
	);
	const components: Components = {
		h1: ({ children, ...props }) => (
			<h1 className="an-md-h1 mt-3 mb-1.5 font-semibold text-base" {...props}>
				{children}
			</h1>
		),
		h2: ({ children, ...props }) => (
			<h2 className="an-md-h2 mt-3 mb-1.5 font-semibold text-base" {...props}>
				{children}
			</h2>
		),
		h3: ({ children, ...props }) => (
			<h3 className="an-md-h3 mt-2 mb-1 font-semibold text-sm" {...props}>
				{children}
			</h3>
		),
		h4: ({ children, ...props }) => (
			<h4 className="an-md-h4 mt-2 mb-1 font-medium text-sm" {...props}>
				{children}
			</h4>
		),
		p: ({ children, ...props }) => (
			<p
				className="an-md-p text-foreground/80 text-sm leading-relaxed"
				{...props}
			>
				{children}
			</p>
		),
		ul: ({ children, ...props }) => (
			<ul
				className="an-md-ul mb-2 list-outside list-disc space-y-0.5 pl-4 text-foreground/80 text-sm"
				{...props}
			>
				{children}
			</ul>
		),
		ol: ({ children, ...props }) => (
			<ol
				className="an-md-ol mb-2 list-outside list-decimal space-y-0.5 pl-5 text-foreground/80 text-sm"
				{...props}
			>
				{children}
			</ol>
		),
		li: ({ children, ...props }) => (
			<li className="an-md-li pl-0.5 text-foreground/80 text-sm" {...props}>
				{children}
			</li>
		),
		strong: ({ children, ...props }) => (
			<strong className="font-medium text-foreground" {...props}>
				{children}
			</strong>
		),
		a: ({ href, children, ...props }) => {
			if (!href) {
				return <span>{children}</span>;
			}
			if (href.startsWith("#ryu-cite-")) {
				const n = Number(href.replace("#ryu-cite-", ""));
				const citation = Number.isFinite(n)
					? citations?.find((c) => c.number === n)
					: undefined;
				if (!citation) {
					return <span>{children}</span>;
				}
				return <CitationMarkLink citation={citation} />;
			}
			if (href.startsWith("#ryu-mention-")) {
				const mentionHref = href.slice("#ryu-mention-".length);
				// Resolve the complete kind+label token first. New mention kinds may
				// contain hyphens (for example `app-item`), while older persisted
				// messages use the original `kind-label` wire shape.
				const resolvedMention = mentionItems?.find((candidate) =>
					[candidate.label, candidate.id].some(
						(value) =>
							value !== undefined &&
							mentionHref === `${candidate.kind}-${encodeURIComponent(value)}`
					)
				);
				const separator = mentionHref.indexOf("-");
				const kind =
					resolvedMention?.kind ??
					(separator === -1 ? mentionHref : mentionHref.slice(0, separator));
				const encodedLabel = resolvedMention
					? ""
					: separator === -1
						? ""
						: mentionHref.slice(separator + 1);
				const label = encodedLabel ? decodeMentionLabel(encodedLabel) : "";
				const item =
					resolvedMention ??
					mentionItems?.find(
						(candidate) =>
							candidate.kind === kind &&
							(candidate.label === label || candidate.id === label)
					);
				const mentionContent = (
					<MentionToken item={item}>{children}</MentionToken>
				);
				if (item && item.kind !== "user" && onOpenMention) {
					return (
						<button
							aria-label={`Open ${item.kind} ${item.label}`}
							className="an-md-mention inline-flex max-w-full cursor-pointer rounded p-0 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
							data-mention-id={item.id}
							data-mention-kind={item.kind}
							onClick={(event) => {
								event.preventDefault();
								onOpenMention(item);
							}}
							title={`Open ${item.label}`}
							type="button"
						>
							{mentionContent}
						</button>
					);
				}
				return (
					<strong
						className="inline-flex items-center gap-1 font-semibold text-primary"
						data-mention-id={item?.id}
						data-mention-kind={item?.kind}
						{...props}
					>
						{mentionContent}
					</strong>
				);
			}
			if (/^#ryu-file-\d+$/.test(href)) {
				const index = Number(href.replace("#ryu-file-", ""));
				const ref = Number.isFinite(index)
					? fileReferences?.[index]
					: undefined;
				if (!ref) {
					return <span>{children}</span>;
				}
				return (
					<button
						className="an-md-file-link inline-flex items-center rounded px-0.5 text-primary underline-offset-2 hover:underline"
						onClick={(event) => {
							event.preventDefault();
							onOpenFile?.(ref.path);
						}}
						title={ref.path}
						type="button"
					>
						<FileTypeIcon className="mr-1 size-3.5" path={ref.path} />
						{children}
					</button>
				);
			}
			const mentionedFile = decodeMentionHref(href, "#ryu-file-path-");
			if (mentionedFile) {
				return (
					<LinkPreview
						resolvers={previewResolvers}
						target={{ kind: "file", value: mentionedFile }}
					>
						<button
							className="an-md-file-link inline-flex items-center rounded px-0.5 text-primary underline-offset-2 hover:underline"
							onClick={(event) => {
								event.preventDefault();
								onOpenFile?.(mentionedFile);
							}}
							title={mentionedFile}
							type="button"
						>
							<FileTypeIcon className="mr-1 size-3.5" path={mentionedFile} />
							{children}
						</button>
					</LinkPreview>
				);
			}
			const mentionedWebsite = decodeMentionHref(href, "#ryu-web-url-");
			const destination = mentionedWebsite ?? href;
			const isExternal =
				destination.startsWith("http") || destination.startsWith("mailto:");
			const link = (
				<a
					{...props}
					className="an-md-link text-primary underline-offset-2 hover:underline"
					href={destination}
					onClick={
						isExternal && onOpenLink
							? (event) => {
									event.preventDefault();
									onOpenLink(destination);
								}
							: undefined
					}
					rel={isExternal ? "noopener noreferrer" : undefined}
					target={isExternal ? "_blank" : undefined}
				>
					{children}
				</a>
			);
			return destination.startsWith("http") ? (
				<LinkPreview
					resolvers={previewResolvers}
					target={{ kind: "website", value: destination }}
				>
					{link}
				</LinkPreview>
			) : (
				link
			);
		},
		blockquote: ({ children, ...props }) => (
			<blockquote
				className="an-md-blockquote mb-2 border-border border-l-2 pl-3 text-foreground/70 text-sm italic"
				{...props}
			>
				{children}
			</blockquote>
		),
		hr: ({ ...props }) => (
			<hr className="an-md-hr my-4 border-border" {...props} />
		),
		table: (props) => <ExpandableMarkdownTable {...props} />,
		th: ({ children, ...props }) => (
			<th className="bg-muted px-3 py-2 text-left font-medium" {...props}>
				{children}
			</th>
		),
		td: ({ children, ...props }) => (
			<td
				className="border-border border-t px-3 py-2 text-foreground/80"
				{...props}
			>
				{children}
			</td>
		),
	};

	return (
		<div
			className={cn(
				"an-markdown",
				"wrap-break-word overflow-hidden",
				"[&_li>p]:mb-0 [&_li>p]:inline",
				className
			)}
			data-code-detail={expandCodeBlocks ? "full" : "capped"}
		>
			<Streamdown
				animated={isAnimating ? STREAM_ANIMATION : false}
				components={components}
				isAnimating={isAnimating}
				plugins={{ code }}
			>
				{safeContent}
			</Streamdown>
		</div>
	);
}
