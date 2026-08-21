"use client";

import { LinkPlugin } from "@platejs/link/react";
import { MarkdownPlugin } from "@platejs/markdown";
import { MentionPlugin } from "@platejs/mention/react";
import { AlignKit } from "@ryu/ui/components/editor/plugins/align-kit.tsx";
import { AutoformatKit } from "@ryu/ui/components/editor/plugins/autoformat-kit.tsx";
import { BasicBlocksKit } from "@ryu/ui/components/editor/plugins/basic-blocks-kit.tsx";
import { BasicMarksKit } from "@ryu/ui/components/editor/plugins/basic-marks-kit.tsx";
import { CalloutKit } from "@ryu/ui/components/editor/plugins/callout-kit.tsx";
import { CodeBlockKit } from "@ryu/ui/components/editor/plugins/code-block-kit.tsx";
import { ColumnKit } from "@ryu/ui/components/editor/plugins/column-kit.tsx";
import { DateKit } from "@ryu/ui/components/editor/plugins/date-kit.tsx";
import { EmojiKit } from "@ryu/ui/components/editor/plugins/emoji-kit.tsx";
import { ExitBreakKit } from "@ryu/ui/components/editor/plugins/exit-break-kit.tsx";
import { FontKit } from "@ryu/ui/components/editor/plugins/font-kit.tsx";
import { LineHeightKit } from "@ryu/ui/components/editor/plugins/line-height-kit.tsx";
import { LinkKit } from "@ryu/ui/components/editor/plugins/link-kit.tsx";
import { ListKit } from "@ryu/ui/components/editor/plugins/list-kit.tsx";
import { MarkdownKit } from "@ryu/ui/components/editor/plugins/markdown-kit.tsx";
import { MathKit } from "@ryu/ui/components/editor/plugins/math-kit.tsx";
import { MediaKit } from "@ryu/ui/components/editor/plugins/media-kit.tsx";
import { TableKit } from "@ryu/ui/components/editor/plugins/table-kit.tsx";
import { TocKit } from "@ryu/ui/components/editor/plugins/toc-kit.tsx";
import { ToggleKit } from "@ryu/ui/components/editor/plugins/toggle-kit.tsx";
import { WikiLinkKit } from "@ryu/ui/components/editor/plugins/wikilink-kit.tsx";
import {
	Editor,
	EditorContainer,
} from "@ryu/ui/components/editor/ui/editor.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import {
	KEYS,
	setValue,
	type TMentionElement,
	TrailingBlockPlugin,
	type Value,
} from "platejs";
import type { PlateElementProps } from "platejs/react";
import { Plate, PlateElement, usePlateEditor } from "platejs/react";
import type {
	ClipboardEvent,
	KeyboardEvent,
	ReactNode,
	RefObject,
} from "react";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";

export interface ComposerMentionItem {
	accentColor?: string;
	icon?: ReactNode;
	id?: string;
	kind: string;
	label: string;
	visualIcon?: ReactNode;
}

export interface ComposerEditorProps {
	disabled?: boolean;
	editorRef?: RefObject<HTMLDivElement | null>;
	markdown: string;
	mentionItems?: ComposerMentionItem[];
	mentionRenderer?: (label: string, item?: ComposerMentionItem) => ReactNode;
	onChange: (markdown: string) => void;
	onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
	onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void;
	placeholder?: string;
}

interface ComposerMentionContextValue {
	items: ComposerMentionItem[];
	renderer?: ComposerEditorProps["mentionRenderer"];
}

const ComposerMentionContext = createContext<ComposerMentionContextValue>({
	items: [],
});

function ComposerMentionElement(props: PlateElementProps<TMentionElement>) {
	const { items, renderer } = useContext(ComposerMentionContext);
	const value = String(props.element.value ?? "").replace(/^@/, "");
	const item = items.find(
		(candidate) => candidate.label === value || candidate.id === value
	);
	const label = item?.label ?? value;
	const content = renderer ? renderer(`@${label}`, item) : `@${label}`;

	return (
		<PlateElement
			{...props}
			attributes={{
				...props.attributes,
				contentEditable: false,
				"data-slate-value": value,
			}}
			className="inline-block align-baseline"
		>
			{content}
		</PlateElement>
	);
}

const ComposerMentionKit = [
	MentionPlugin.configure({
		options: {
			triggerPreviousCharPattern: /^$|^[\s"']$/,
		},
	}).withComponent(ComposerMentionElement),
];

const ComposerEditorKit = [
	...BasicBlocksKit,
	...CodeBlockKit,
	...TableKit,
	...ToggleKit,
	...TocKit,
	...MediaKit,
	...CalloutKit,
	...ColumnKit,
	...MathKit,
	...DateKit,
	...LinkKit,
	...ComposerMentionKit,
	...WikiLinkKit,
	...BasicMarksKit,
	...FontKit,
	...ListKit,
	...AlignKit,
	...LineHeightKit,
	...AutoformatKit,
	...EmojiKit,
	...ExitBreakKit,
	TrailingBlockPlugin,
	...MarkdownKit,
];

const MENTION_LINK_RE = /\[([^\]]+)\]\(mention:([^\s)]+)\)/g;

function escapeMarkdownText(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("[", "\\[")
		.replaceAll("]", "\\]");
}

export function mentionMarkdown(
	value: string,
	items: ComposerMentionItem[]
): string {
	const candidates = items
		.flatMap((item) => [
			{ item, token: `@${item.label}` },
			...(item.id && item.id !== item.label
				? [{ item, token: `@${item.id}` }]
				: []),
		])
		.sort((left, right) => right.token.length - left.token.length);
	if (candidates.length === 0) {
		return value;
	}

	let output = "";
	let cursor = 0;
	while (cursor < value.length) {
		let match:
			| { end: number; item: ComposerMentionItem; start: number; token: string }
			| undefined;
		for (let index = cursor; index < value.length; index += 1) {
			if (index > 0 && !/\s/.test(value[index - 1] ?? "")) {
				continue;
			}
			const candidate = candidates.find(({ token }) =>
				value.startsWith(token, index)
			);
			if (!candidate) {
				continue;
			}
			const end = index + candidate.token.length;
			const next = value[end];
			if (next && !/[\s.,;:!?)]/.test(next)) {
				continue;
			}
			match = {
				end,
				item: candidate.item,
				start: index,
				token: candidate.token,
			};
			break;
		}
		if (!match) {
			output += value.slice(cursor);
			break;
		}
		output += value.slice(cursor, match.start);
		const mentionId = encodeURIComponent(match.item.id ?? match.item.label)
			.replaceAll("(", "%28")
			.replaceAll(")", "%29");
		output += `[${escapeMarkdownText(match.token)}](mention:${mentionId})`;
		cursor = match.end;
	}
	return output;
}

export function serializeComposerMarkdown(markdown: string): string {
	return markdown.replace(MENTION_LINK_RE, (_match, displayText: string) => {
		const clean = displayText.replaceAll("**", "");
		return clean.startsWith("@") ? clean : `@${clean}`;
	});
}

export function ComposerEditor({
	disabled = false,
	editorRef,
	markdown,
	mentionItems = [],
	mentionRenderer,
	onChange,
	onKeyDown,
	onPaste,
	placeholder,
}: ComposerEditorProps) {
	const mentionContext = useMemo(
		() => ({ items: mentionItems, renderer: mentionRenderer }),
		[mentionItems, mentionRenderer]
	);
	const editor = usePlateEditor({
		plugins: ComposerEditorKit,
		value: (ed) =>
			ed
				.getApi(MarkdownPlugin)
				.markdown.deserialize(mentionMarkdown(markdown, mentionItems)),
	});
	const lastMarkdownRef = useRef(markdown);

	useEffect(() => {
		if (markdown === lastMarkdownRef.current) {
			return;
		}
		const next = editor
			.getApi(MarkdownPlugin)
			.markdown.deserialize(mentionMarkdown(markdown, mentionItems));
		setValue(editor, next as Value);
		lastMarkdownRef.current = markdown;
	}, [editor, markdown, mentionItems]);

	return (
		<ComposerMentionContext.Provider value={mentionContext}>
			<Plate
				editor={editor}
				onChange={({ editor: changedEditor }) => {
					const next = serializeComposerMarkdown(
						changedEditor.getApi(MarkdownPlugin).markdown.serialize()
					);
					lastMarkdownRef.current = next;
					onChange(next);
				}}
			>
				<EditorContainer
					className={cn(
						"min-h-[40px] overflow-visible rounded-xl border-0 bg-transparent shadow-none",
						disabled && "cursor-not-allowed opacity-50"
					)}
					style={{ maskImage: "none", WebkitMaskImage: "none" }}
					variant="comment"
				>
					<Editor
						className="max-h-[240px] min-h-[40px] overflow-y-auto px-0 py-1.5 text-[14px] leading-[1.6]"
						disabled={disabled}
						onKeyDown={onKeyDown}
						onPaste={(event) => {
							onPaste?.(event);
							// Plate's synthetic paste path can leave the caret just after
							// a newly-created link, so the floating link controls never
							// enter edit mode. Re-anchor to the inserted link after the
							// plugin has applied the paste; normal typing is unaffected.
							window.setTimeout(() => {
								const entry = editor.api
									.nodes({
										at: [],
										match: { type: editor.getType(KEYS.link) },
										mode: "all",
									})
									.next().value;
								if (entry) {
									editor.tf.select(editor.api.start(entry[1]));
									editor
										.getApi(LinkPlugin)
										.floatingLink.show("edit", editor.id);
								}
							}, 0);
						}}
						placeholder={placeholder}
						ref={editorRef}
						variant="none"
					/>
				</EditorContainer>
			</Plate>
		</ComposerMentionContext.Provider>
	);
}
