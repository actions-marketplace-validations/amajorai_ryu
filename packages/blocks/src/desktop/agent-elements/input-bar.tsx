"use client";

import { PatchDiff } from "@pierre/diffs/react";
import { Button } from "@ryu/ui/components/button";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@ryu/ui/components/hover-card";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@ryu/ui/components/popover";
import { Wave } from "@ryu/ui/components/wave";
import { cn } from "@ryu/ui/lib/utils";
import type { ChatStatus } from "ai";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

/**
 * Bars in the full-width recording waveform that replaces the textarea while the
 * mic is live. High enough to read as a dense, ChatGPT-style waveform spanning
 * the whole input; the recorder keeps a longer amplitude history to feed these.
 */
const RECORDING_WAVE_BARS = 48;

interface InputConfig {
	attachmentPreviewStyle: "thumbnail" | "chip" | "hidden";
	inputBarPlaceholder: string;
}

const DEFAULT_INPUT_CONFIG: InputConfig = {
	inputBarPlaceholder: "What do you want to do?",
	attachmentPreviewStyle: "thumbnail",
};

/** Stable fallback so the voice hook can be called unconditionally. */
const noopTranscribe = async (): Promise<string> => "";

import {
	IconBookmark,
	IconChevronDown,
	IconChevronUp,
	IconCircle,
	IconCircleCheck,
	IconGhost2,
	IconLoader2,
	IconMessageCircleQuestion,
	IconWorld,
	IconX,
} from "@tabler/icons-react";
import type { ContextUsage } from "./context-usage.tsx";
import { FileTypeIcon } from "./file-type-icon.tsx";
import type {
	ComposerMenuGroup,
	ComposerMenuItem,
} from "./input/composer-menu.tsx";
import { ComposerToolbar } from "./input/composer-toolbar.tsx";
import { FileAttachment } from "./input/file-attachment.tsx";
import { GoalBar, type GoalBarProps } from "./input/goal-bar.tsx";
import type {
	DoubleCheckControls,
	GhostControls,
	GoalControls,
	PluginComposerControlRow,
} from "./input/goal-plus-button.tsx";
import { useInputTyping } from "./input/input-typing.tsx";
import { type SuggestionItem, Suggestions } from "./input/suggestions.tsx";
import { findMentionAt } from "./mention-format.ts";
import { NumberRoll } from "./number-roll.tsx";
import type {
	QuestionAnswer,
	QuestionConfig,
} from "./question/question-prompt.tsx";
import { QuestionPrompt } from "./question/question-prompt.tsx";
import { QueueBar, type QueueBarProps } from "./queue/queue-bar.tsx";
import type { MentionItem } from "./types.ts";
import { useVoiceRecorder } from "./useVoiceRecorder.ts";

export interface AttachedImage {
	filename: string;
	id: string;
	mimeType?: string;
	size?: number;
	url: string;
}

export interface ComposerDraftItem {
	id: string;
	preview: string;
	text: string;
}
export interface ComposerDraftControls {
	items: ComposerDraftItem[];
	onDelete: (id: string) => void;
	onInsert: (text: string) => void;
	onSave: (text: string) => void;
}

export interface AttachedFile {
	filename: string;
	id: string;
	size?: number;
}

/**
 * Composer info-bar strip (top or bottom of the outer card). Use
 * `variant: "destructive"` for errors — `bg-destructive/10` so they sit above
 * the input instead of crowding the workspace / sources footer.
 */
export interface InputBarInfoBar {
	/** Optional primary action rendered on the right (e.g. "Upgrade"). */
	action?: {
		label: string;
		onClick: () => void;
	};
	/** Optional compact actions rendered on the right, before `action`. */
	actions?: {
		label: string;
		onClick: () => void;
		variant?: "default" | "secondary" | "ghost";
	}[];
	description?: string;
	onClose?: () => void;
	position?: "top" | "bottom";
	title?: string;
	/** Visual tone. `"destructive"` uses a soft red wash for composer errors. */
	variant?: "default" | "destructive";
}

export interface InputBarProps {
	attachedFiles?: AttachedFile[];
	attachedImages?: AttachedImage[];
	autoFocus?: boolean;
	changeSummary?: {
		files: number;
		insertions: number;
		deletions: number;
	};
	className?: string;

	/**
	 * Denser composer: a tighter textarea block above the SAME stacked controls
	 * row every surface renders (the "+" and the agent selector on the left, the
	 * trailing mic/send on the right). Used on the chat page once a conversation
	 * has history, where the bar should give the transcript back some height.
	 *
	 * It is a density flag only. It used to switch the whole bar to a single-row
	 * layout with the textarea wedged between the two control clusters, so the
	 * chat page and the launchpad were two structurally different composers behind
	 * one boolean; the layout is now shared and only the padding differs.
	 */
	compact?: boolean;

	/**
	 * Node rendered inside the composer box, above the textarea (and above any
	 * attachment chips) — e.g. a pending quote preview. Shares the box's rounded
	 * `bg-muted` fill so it reads as part of the composer.
	 */
	composerHeader?: React.ReactNode;
	/** Searchable apps/plugins/context rows shown by the shared + menu. */
	composerMenuGroups?: ComposerMenuGroup[];

	/**
	 * Context-window usage for the persistent composer meter (donut ring +
	 * used-percentage, left of the model selector). Derived by the host from the
	 * conversation's latest usage stats; omit to hide.
	 */
	contextMeter?: ContextUsage;
	/** Open the full context breakdown when the meter is clicked. Omit to keep
	 *  the meter a read-only ring. */
	contextMeterOnOpen?: () => void;
	disabled?: boolean;

	/**
	 * Double-check (`/double-check`) affordances for the composer "+" dropdown.
	 * When provided, the dropdown gains a "Double-check" toggle row and a verdict
	 * badge appears beside the "+" once a review has run.
	 */
	doubleCheckControls?: DoubleCheckControls;
	draftControls?: ComposerDraftControls;
	/**
	 * When true (default) clicking a staged image attachment opens a
	 * fullscreen lightbox preview. Set to false to render thumbnails as
	 * plain non-interactive previews.
	 */
	enableImagePreview?: boolean;

	/**
	 * Allow submitting while a run is streaming. When true, pressing Enter (or the
	 * primary send button) calls `onSend` even mid-stream so the host can enqueue the
	 * message instead of dropping it. Defaults to false (legacy block behaviour).
	 */
	enableQueue?: boolean;

	/**
	 * Ghost (temporary/incognito) chat active. When true, the composer box gets a
	 * persistent violet ring so it's visually obvious the current thread isn't
	 * being saved — mirroring the temporary-chat cue in ChatGPT / Grok.
	 */
	ghost?: boolean;

	/**
	 * Temporary-chat toggle for the composer "+" dropdown. When provided, the
	 * dropdown gains a "Temporary chat" row that flips {@link ghost}. Separate from
	 * `ghost` (which only drives the violet ring) so the host can hide the toggle
	 * — e.g. once a thread has messages — while still showing the active-ghost ring.
	 */
	ghostControls?: GhostControls;

	/**
	 * The goal bar rendered above the composer while a goal is active or being
	 * drafted. Mirrors the info-bar treatment. Omit to hide.
	 */
	goalBar?: GoalBarProps;

	/**
	 * Goal (`/goal`) affordances for the composer "+" dropdown and the active-goal
	 * chip. When provided, the "+" opens a menu (Add photos & files | Pursue goal).
	 */
	goalControls?: GoalControls;

	infoBar?: InputBarInfoBar;
	isDragOver?: boolean;

	/** Content rendered on the left of the toolbar, next to the attachment button. */
	leftActions?: React.ReactNode;
	/** Resolved @ mentions used to paint the live composer preview. */
	mentionItems?: MentionItem[];

	// Attachment support
	onAttach?: () => void;
	onChange?: (value: string) => void;
	onComposerMenuSelect?: (item: ComposerMenuItem) => void;

	/**
	 * Image generation. When provided, an image button appears in the toolbar
	 * (beside the mic) that takes the composer text as the prompt, generates an
	 * image via Core's /api/images/generate, and clears the composer. The host
	 * surfaces the resulting image in the conversation. Mirrors `voice`: the
	 * draft text is owned by this component, so the host receives only the prompt.
	 */
	onGenerateImage?: (prompt: string) => void | Promise<void>;

	/**
	 * Video generation. When provided, a video button appears beside image gen.
	 * Mirrors {@link onGenerateImage}: takes the composer text as the prompt,
	 * generates via Core's /api/video/generate, and clears the composer. Needs a
	 * video model loaded in the sdcpp engine to produce anything.
	 */
	onGenerateVideo?: (prompt: string) => void | Promise<void>;
	onPaste?: (e: React.ClipboardEvent) => void;
	onRemoveFile?: (id: string) => void;
	onRemoveImage?: (id: string) => void;
	onSend: (message: {
		role: "user";
		content: string;
		followUpMode?: "opposite";
	}) => void;
	onStop: () => void;
	/** Optional host-level keyboard handling for the raw textarea. */
	onTextareaKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
	placeholder?: string;
	/** Ghost prompt and keyboard-navigable prompt list supplied by a host/plugin. */
	placeholderSuggestion?: string;

	/**
	 * Composer toggles contributed by enabled plugins (`composer_controls`). Each
	 * renders as a toggle row in the "+" dropdown's Assist section; flipping one
	 * sets its `flag` in the per-request `plugin_flags` map. Threaded straight to
	 * the toolbar's `GoalPlusButton`.
	 */
	pluginControls?: PluginComposerControlRow[];

	questionBar?: {
		id: string;
		questions: QuestionConfig[];
		questionIndex?: number;
		totalQuestions?: number;
		onPreviousQuestion?: () => void;
		onNextQuestion?: () => void;
		submitLabel?: string;
		skipLabel?: string;
		allowSkip?: boolean;
		onSubmit: (answer: QuestionAnswer) => void;
		onSkip?: () => void;
	};

	/**
	 * Message queue. When provided, queued messages are listed in a bar above the
	 * composer (rendered like the info/question bars). The host owns the queue
	 * state and dispatch (see `useMessageQueue`); this is purely presentational.
	 */
	queueBar?: QueueBarProps;
	/** Content rendered on the right of the toolbar, before the send button. */
	rightActions?: React.ReactNode;
	status: ChatStatus;
	suggestions?:
		| SuggestionItem[]
		| {
				items: SuggestionItem[];
				className?: string;
				itemClassName?: string;
		  };
	/** Live plan and file edits derived from the current user turn. */
	turnProgress?: InputBarTurnProgress;

	// Typing animation
	typingAnimation?: {
		text: string;
		duration: number;
		image?: string;
		isActive: boolean;
		onComplete: () => void;
	};

	// Controlled mode
	value?: string;

	/**
	 * Voice input. When provided, a microphone button appears in the toolbar that
	 * records from the user's default mic, shows a live waveform, and appends the
	 * transcription to the composer text. `transcribe` uploads the recorded WAV
	 * and resolves with the transcript (wired to Core's /api/voice/transcribe).
	 */
	voice?: {
		transcribe: (audio: Blob) => Promise<string>;
		disabled?: boolean;
	};

	/**
	 * Live voice-mode (realtime conversation) entry. When provided, the trailing
	 * button's empty state becomes the voice-mode waveform (opens the full-screen
	 * overlay) instead of the STT mic; STT dictation (`voice`) relocates to its own
	 * small toolbar button. `onStart` opens voice mode.
	 */
	voiceMode?: {
		onStart: () => void;
		disabled?: boolean;
	};

	/**
	 * Workspace strip rendered as a separate row BELOW the composer box
	 * (Codex/Cowork-style project ▸ branch ▸ worktree controls). Omit to hide.
	 * Distinct from `leftActions`, which sit in the controls row inside the box.
	 */
	workspaceBar?: React.ReactNode;
}

export interface InputBarTurnProgress {
	deletions: number;
	files: {
		deletions: number;
		insertions: number;
		preview?: string;
		path: string;
	}[];
	insertions: number;
	plan?: {
		current: number;
		items: {
			label: string;
			status: "completed" | "in_progress" | "pending";
		}[];
		total: number;
	};
}

function TurnProgressFile({
	file,
}: {
	file: InputBarTurnProgress["files"][number];
}) {
	const row = (
		<button
			className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-muted"
			type="button"
		>
			<FileTypeIcon className="size-4 shrink-0" path={file.path} />
			<span className="min-w-0 flex-1 truncate">{file.path}</span>
			<span className="text-emerald-600 tabular-nums dark:text-emerald-400">
				+{file.insertions}
			</span>
			<span className="text-red-600 tabular-nums dark:text-red-400">
				-{file.deletions}
			</span>
		</button>
	);
	if (!file.preview) {
		return row;
	}
	return (
		<HoverCard>
			<HoverCardTrigger closeDelay={120} delay={160} render={row} />
			<HoverCardContent
				align="start"
				className="w-[min(42rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border-border/70 bg-popover/95 p-2 shadow-xl backdrop-blur-xl"
				side="top"
				sideOffset={8}
			>
				<div className="mb-1 px-2 py-1 font-mono text-muted-foreground text-xs">
					{file.path}
				</div>
				<div className="max-h-[28rem] overflow-auto rounded-xl border border-border/60 bg-background/60">
					<PatchDiff
						disableWorkerPool
						options={{
							diffStyle: "unified",
							lineHoverHighlight: "line",
						}}
						patch={file.preview}
					/>
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: legacy component
export const InputBar = memo(function InputBar({
	onSend,
	status,
	onStop,
	placeholder,
	placeholderSuggestion,
	className,
	onAttach,
	attachedImages = [],
	attachedFiles = [],
	changeSummary,
	turnProgress,
	onRemoveImage,
	onRemoveFile,
	onPaste,
	isDragOver,
	enableImagePreview = true,
	value: controlledValue,
	onChange: controlledOnChange,
	contextMeter,
	contextMeterOnOpen,
	disabled,
	compact,
	ghost,
	ghostControls,
	autoFocus,
	suggestions = [],
	typingAnimation,
	infoBar,
	questionBar,
	queueBar,
	enableQueue,
	leftActions,
	rightActions,
	draftControls,
	voice,
	voiceMode,
	onGenerateImage,
	onGenerateVideo,
	goalControls,
	doubleCheckControls,
	pluginControls,
	goalBar,
	workspaceBar,
	composerHeader,
	composerMenuGroups,
	mentionItems,
	onComposerMenuSelect,
	onTextareaKeyDown,
}: InputBarProps) {
	const [internalInput, setInternalInput] = useState("");
	const [isInfoBarOpen, setIsInfoBarOpen] = useState(true);
	const [dismissedQuestionId, setDismissedQuestionId] = useState<string | null>(
		null
	);
	const [questionBarIndex, setQuestionBarIndex] = useState(1);
	const [suggestionIndex, setSuggestionIndex] = useState(-1);
	const isControlled = controlledValue !== undefined;
	const input = isControlled ? controlledValue : internalInput;
	const setInput = useCallback(
		(v: string) => {
			if (isControlled) {
				controlledOnChange?.(v);
			} else {
				setInternalInput(v);
			}
		},
		[isControlled, controlledOnChange]
	);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [plusMenuQueryStart, setPlusMenuQueryStart] = useState<number | null>(
		null
	);
	const config = DEFAULT_INPUT_CONFIG;

	// Voice input: record from the default mic, show a live waveform, and append
	// the transcript to the composer. The hook is always called (Rules of Hooks);
	// its UI only renders when a `voice` prop is supplied.
	const appendTranscript = useCallback(
		(text: string) => {
			const base = input.trim();
			setInput(base ? `${base} ${text}` : text);
			requestAnimationFrame(() => textareaRef.current?.focus());
		},
		[input, setInput]
	);
	const {
		state: voiceState,
		levels: voiceLevels,
		error: voiceError,
		clearError: clearVoiceError,
		start: startVoice,
		stop: stopVoice,
	} = useVoiceRecorder({
		transcribe: voice?.transcribe ?? noopTranscribe,
		onTranscript: appendTranscript,
	});
	const isRecording = voiceState === "recording";
	const isTranscribing = voiceState === "transcribing";

	// Voice / mic failures surface on the top info-bar (destructive) so they
	// don't crowd the workspace / sources footer under the input.
	const effectiveInfoBar: InputBarInfoBar | undefined = voiceError
		? {
				description: voiceError,
				variant: "destructive",
				position: "top",
				onClose: clearVoiceError,
			}
		: infoBar;

	// Re-open the strip whenever its content changes (new error, new banner).
	useEffect(() => {
		if (
			effectiveInfoBar &&
			(effectiveInfoBar.title || effectiveInfoBar.description)
		) {
			setIsInfoBarOpen(true);
		}
	}, [
		effectiveInfoBar?.title,
		effectiveInfoBar?.description,
		effectiveInfoBar?.variant,
	]);

	// Image generation: take the composer text as the prompt, hand it to the host
	// (which calls Core's /api/images/generate and surfaces the result), then clear
	// the composer. An in-flight flag disables the button while the engine works —
	// sd-server runs on CPU and can be slow, so the control must not look dead.
	const [isGenerating, setIsGenerating] = useState(false);
	const handleGenerateImage = useCallback(() => {
		const prompt = input.trim();
		if (!(prompt && onGenerateImage) || isGenerating) {
			return;
		}
		setIsGenerating(true);
		setInput("");
		Promise.resolve(onGenerateImage(prompt)).finally(() => {
			setIsGenerating(false);
		});
	}, [input, onGenerateImage, isGenerating, setInput]);

	// Video generation mirrors image generation. Separate in-flight flag so the
	// two buttons disable independently.
	const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
	const handleGenerateVideo = useCallback(() => {
		const prompt = input.trim();
		if (!(prompt && onGenerateVideo) || isGeneratingVideo) {
			return;
		}
		setIsGeneratingVideo(true);
		setInput("");
		Promise.resolve(onGenerateVideo(prompt)).finally(() => {
			setIsGeneratingVideo(false);
		});
	}, [input, onGenerateVideo, isGeneratingVideo, setInput]);

	const isStreaming = status === "streaming" || status === "submitted";
	const isTyping = typingAnimation?.isActive ?? false;

	const { displayedText, showImage } = useInputTyping(
		typingAnimation?.text ?? "",
		typingAnimation?.duration ?? 2000,
		isTyping,
		typingAnimation?.onComplete ?? (() => {})
	);

	const canQueueNow = Boolean(enableQueue) && isStreaming;
	const effectivePlaceholder =
		canQueueNow && !isTyping
			? "Send a message…"
			: (placeholder ?? config.inputBarPlaceholder);

	const showAttach = Boolean(onAttach);

	// Auto-resize textarea
	useEffect(() => {
		const el = textareaRef.current;
		if (!el) {
			return;
		}
		el.style.height = "0";
		const nextHeight = Math.min(el.scrollHeight, 120);
		el.style.height = `${nextHeight}px`;
		el.style.overflowY = el.scrollHeight > 120 ? "auto" : "hidden";
		el.style.overflowX = "hidden";
		// Re-measure on every value change so the textarea grows/shrinks with its
		// content (one row by default, expanding up to the 120px cap). Without
		// `input` in the deps this only ran on mount and the box never resized.
		// A repo-wide lint/format sweep (9fed37659) emptied this array once already
		// and the composer went back to a permanently one-line box — `input` is
		// load-bearing, not a lint artefact.
	}, [input]);

	useEffect(() => {
		if (!autoFocus) {
			return;
		}
		textareaRef.current?.focus();
	}, [autoFocus]);

	const handleSubmit = useCallback(
		(followUpMode?: "opposite") => {
			const trimmed = input.trim();
			if (!trimmed) {
				// Empty composer: Enter sends the first queued message now (same as the
				// queue row's "send now" affordance).
				const first = queueBar?.items[0];
				if (first && queueBar?.onSendNow && !disabled) {
					queueBar.onSendNow(first.id);
				}
				return;
			}
			// When queueing is enabled, allow submit mid-stream so the host can enqueue
			// the message rather than drop it. Otherwise keep the legacy block.
			if (disabled || (isStreaming && !enableQueue)) {
				return;
			}
			onSend({ role: "user", content: trimmed, followUpMode });
			setInput("");
		},
		[input, isStreaming, disabled, enableQueue, onSend, setInput, queueBar]
	);

	const handleInfoBarClose = useCallback(() => {
		setIsInfoBarOpen(false);
		if (voiceError) {
			clearVoiceError();
		} else {
			infoBar?.onClose?.();
		}
	}, [voiceError, clearVoiceError, infoBar]);

	const infoBarPosition = effectiveInfoBar?.position ?? "top";
	const infoBarVariant = effectiveInfoBar?.variant ?? "default";
	const isDestructiveInfoBar = infoBarVariant === "destructive";
	const shouldShowInfoBar = Boolean(
		effectiveInfoBar && (effectiveInfoBar.title || effectiveInfoBar.description)
	);
	const infoBarData = effectiveInfoBar ?? {};

	const infoBarNode = shouldShowInfoBar ? (
		<div
			className={cn(
				"flex h-[34px] items-center justify-between gap-3 px-3",
				"overflow-hidden transition-[max-height,opacity] duration-150 ease-out",
				isInfoBarOpen ? "max-h-[34px] opacity-100" : "max-h-0 opacity-0",
				infoBarPosition === "top" ? "rounded-t-2xl" : "rounded-b-2xl",
				isDestructiveInfoBar && "bg-destructive/10"
			)}
			role={isDestructiveInfoBar ? "alert" : undefined}
		>
			<div
				className={cn(
					"min-w-0 truncate text-xs",
					isDestructiveInfoBar ? "text-destructive" : "text-foreground"
				)}
			>
				{infoBarData.title && (
					<span className="font-medium">{infoBarData.title}</span>
				)}
				{infoBarData.description && (
					<span
						className={
							isDestructiveInfoBar
								? "text-destructive/80"
								: "text-muted-foreground/80"
						}
					>
						{infoBarData.title
							? ` ${infoBarData.description}`
							: infoBarData.description}
					</span>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-1">
				{infoBarData.actions?.map((action) => (
					<Button
						className="h-6 px-2 text-xs"
						key={action.label}
						onClick={action.onClick}
						size="sm"
						type="button"
						variant={action.variant ?? "secondary"}
					>
						{action.label}
					</Button>
				))}
				{infoBarData.action && (
					<Button
						className="h-6 px-2 text-xs"
						onClick={infoBarData.action.onClick}
						size="sm"
						type="button"
					>
						{infoBarData.action.label}
					</Button>
				)}
				{infoBarData.onClose && (
					<Button
						aria-label="Close"
						className={cn(
							"size-6 shrink-0",
							isDestructiveInfoBar
								? "text-destructive/70 hover:text-destructive"
								: "text-muted-foreground/70 hover:text-foreground"
						)}
						onClick={handleInfoBarClose}
						size="icon"
						type="button"
						variant="ghost"
					>
						<IconX className="h-3.5 w-3.5" strokeWidth={2} />
					</Button>
				)}
			</div>
		</div>
	) : null;

	// Action bar: the workspace strip (project ▸ branch ▸ worktree) rendered as a
	// full-width footer directly beneath the textarea, part of the outer card — a thin
	// muted row with rounded bottom corners, exactly like the info bar's bottom variant.
	//
	// It carries its OWN fill and a hairline above it. The comment above has always
	// described a "muted row", but the element had neither, so it inherited the
	// composer card's background and read as part of the textarea rather than as a
	// strip under it — most obviously in compact mode, where the textarea block is
	// short enough that the two became one undifferentiated box.
	const actionBarNode = workspaceBar ? (
		<div className="flex h-[34px] min-w-0 items-center gap-0.5 rounded-b-2xl border-border/60 border-t bg-muted/40 px-2">
			{workspaceBar}
		</div>
	) : null;

	// Ghost (temporary) chat: a top info-bar strip signalling the thread isn't being
	// saved. Neutral styling (no bg/border of its own) so it shows the frame color
	// like the other bars — the ghost icon + copy carry the signal.
	const ghostBarNode = ghost ? (
		<div className="flex h-[34px] items-center gap-2 rounded-t-2xl px-3 text-[12px] text-muted-foreground">
			<IconGhost2 className="size-3.5 shrink-0" />
			<span className="font-medium text-foreground">Ghost chat</span>
			<span className="truncate">Messages in this chat won't be saved.</span>
		</div>
	) : null;

	const shouldShowQuestionBar = Boolean(
		questionBar && questionBar.id !== dismissedQuestionId
	);
	const questionBarData = questionBar;
	const questionSet = questionBarData?.questions ?? [];
	const hasQuestions = questionSet.length > 0;
	const derivedTotal = hasQuestions ? questionSet.length : 1;
	const totalQuestions = questionBarData?.totalQuestions ?? derivedTotal;
	const hasExternalQuestionNavigation = Boolean(
		questionBarData?.onPreviousQuestion || questionBarData?.onNextQuestion
	);
	const questionIndex = hasExternalQuestionNavigation
		? (questionBarData?.questionIndex ?? 1)
		: questionBarIndex;
	const clampedQuestionIndex = Math.max(
		1,
		Math.min(questionIndex, totalQuestions)
	);
	const activeQuestion = hasQuestions
		? questionSet[clampedQuestionIndex - 1]
		: undefined;
	const showQuestionNavigation = totalQuestions > 1;
	const canGoPrev = clampedQuestionIndex > 1;
	const canGoNext = clampedQuestionIndex < totalQuestions;

	const handleQuestionPrevious = useCallback(() => {
		if (!canGoPrev) {
			return;
		}
		if (questionBarData?.onPreviousQuestion) {
			questionBarData.onPreviousQuestion();
			return;
		}
		setQuestionBarIndex((prev) => Math.max(1, prev - 1));
	}, [canGoPrev, questionBarData]);

	const handleQuestionNext = useCallback(() => {
		if (!canGoNext) {
			return;
		}
		if (questionBarData?.onNextQuestion) {
			questionBarData.onNextQuestion();
			return;
		}
		setQuestionBarIndex((prev) => Math.min(totalQuestions, prev + 1));
	}, [canGoNext, questionBarData, totalQuestions]);

	// Queue bar sits between a top info bar and the question bar. It only rounds
	// its top corners when nothing (info bar) is stacked above it.
	const noTopInfoBar = !shouldShowInfoBar || infoBarPosition === "bottom";
	// Narrow on `queueBar` itself rather than re-reading it optionally per prop:
	// the old form forwarded six `queueBar?.x` values, every one of them
	// `T | undefined`, into props QueueBarProps declares as required. Spreading
	// the narrowed object also keeps the two in step as QueueBarProps grows.
	const queueBarNode =
		queueBar && queueBar.items.length > 0 ? (
			<QueueBar {...queueBar} roundTop={noTopInfoBar} />
		) : null;
	const hasQueue = queueBarNode !== null;

	const questionBarNode =
		shouldShowQuestionBar && activeQuestion ? (
			<div
				className={cn(
					"mx-auto w-full max-w-[calc(100%-24px)] border-border border-x border-t",
					noTopInfoBar && !hasQueue ? "rounded-t-2xl" : null
				)}
			>
				<div className="flex h-7 items-center justify-between border-border border-b px-3 text-muted-foreground text-xs">
					<div className="inline-flex items-center gap-1.5">
						<IconMessageCircleQuestion className="h-3.5 w-3.5" />
						Question
					</div>
					{showQuestionNavigation && (
						<div className="inline-flex items-center gap-1">
							<Button
								aria-label="Previous question"
								className="size-5 rounded-sm"
								disabled={!canGoPrev}
								onClick={handleQuestionPrevious}
								size="icon"
								type="button"
								variant="ghost"
							>
								<IconChevronUp className="h-3.5 w-3.5" />
							</Button>
							<span>
								{clampedQuestionIndex} of {totalQuestions}
							</span>
							<Button
								aria-label="Next question"
								className="size-5 rounded-sm"
								disabled={!canGoNext}
								onClick={handleQuestionNext}
								size="icon"
								type="button"
								variant="ghost"
							>
								<IconChevronDown className="h-3.5 w-3.5" />
							</Button>
						</div>
					)}
				</div>
				<QuestionPrompt
					allowSkip={questionBarData?.allowSkip}
					key={`${clampedQuestionIndex}-${activeQuestion?.title ?? "question"}`}
					onSkip={() => {
						questionBarData?.onSkip?.();
					}}
					onSubmit={(answer) => {
						questionBarData?.onSubmit(answer);
						// `null` is this state's "nothing dismissed" value; an absent
						// question has no id to record.
						setDismissedQuestionId(questionBarData?.id ?? null);
					}}
					questionIndex={clampedQuestionIndex}
					questions={questionSet}
					skipLabel={questionBarData?.skipLabel}
					submitLabel={questionBarData?.submitLabel}
					totalQuestions={totalQuestions}
				/>
			</div>
		) : null;

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			onTextareaKeyDown?.(e);
			if (e.defaultPrevented) {
				return;
			}
			const promptItems = Array.isArray(suggestions)
				? suggestions
				: (suggestions?.items ?? []);
			if (
				!(input.trim() || isStreaming) &&
				e.key === "Tab" &&
				placeholderSuggestion
			) {
				e.preventDefault();
				setInput(placeholderSuggestion);
				return;
			}
			if (
				!(input.trim() || isStreaming) &&
				(e.key === "ArrowDown" || e.key === "ArrowUp")
			) {
				e.preventDefault();
				setSuggestionIndex((current) =>
					Math.max(
						-1,
						Math.min(
							promptItems.length - 1,
							current + (e.key === "ArrowDown" ? 1 : -1)
						)
					)
				);
				return;
			}
			if (
				!(input.trim() || isStreaming) &&
				e.key === "Enter" &&
				suggestionIndex >= 0
			) {
				e.preventDefault();
				const item = promptItems[suggestionIndex];
				if (item) {
					setInput(item.value ?? item.label);
				}
				setSuggestionIndex(-1);
				return;
			}
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleSubmit(e.ctrlKey || e.metaKey ? "opposite" : undefined);
			}
		},
		[
			handleSubmit,
			input,
			isStreaming,
			onTextareaKeyDown,
			setInput,
			suggestionIndex,
			suggestions,
		]
	);

	const hasInput = input.trim().length > 0;
	const composerSuggestions = Array.isArray(suggestions)
		? suggestions
		: (suggestions?.items ?? []);
	const showComposerSuggestions =
		composerSuggestions.length > 0 && !hasInput && !isStreaming;
	const hasContextItems = attachedImages.length > 0 || attachedFiles.length > 0;
	const showContextItems =
		hasContextItems && config.attachmentPreviewStyle !== "hidden";
	const imageDisplayMode =
		config.attachmentPreviewStyle === "thumbnail" ? "image-only" : "chip";
	const effectiveChangeSummary = turnProgress
		? {
				files: turnProgress.files.length,
				insertions: turnProgress.insertions,
				deletions: turnProgress.deletions,
			}
		: changeSummary;
	const showChangeSummary = Boolean(
		effectiveChangeSummary &&
			(effectiveChangeSummary.files > 0 ||
				effectiveChangeSummary.insertions > 0 ||
				effectiveChangeSummary.deletions > 0)
	);
	const showTurnProgress = showChangeSummary || Boolean(turnProgress?.plan);

	const handleContainerClick = useCallback((e: React.MouseEvent) => {
		const target = e.target as HTMLElement;
		// Portaled menus/popovers (agent picker search, etc.) still bubble through
		// the React tree into this container. Skip any interactive control so a
		// click on the picker's search field cannot yank focus back to the prompt.
		if (
			target !== e.currentTarget &&
			target.closest(
				"button, textarea, input, select, a, [role='menuitem'], [contenteditable='true']"
			)
		) {
			return;
		}
		textareaRef.current?.focus();
	}, []);

	const handleSuggestionSelect = useCallback(
		(item: SuggestionItem) => {
			if (disabled || isStreaming) {
				return;
			}
			setInput(item.value ?? item.label);
			requestAnimationFrame(() => {
				const el = textareaRef.current;
				if (!el) {
					return;
				}
				el.focus();
				const end = el.value.length;
				el.setSelectionRange(end, end);
			});
		},
		[disabled, isStreaming, setInput]
	);
	const renderComposerPreview = useCallback((): ReactNode[] => {
		const parts: ReactNode[] = [];
		let cursor = 0;
		for (let index = 0; index < input.length; index += 1) {
			const mention = findMentionAt(input, index, mentionItems);
			const isUrl =
				(index === 0 || /\s/.test(input[index - 1] ?? "")) &&
				/^https?:\/\//i.test(input.slice(index));
			if (!(mention || isUrl)) {
				continue;
			}
			const end = mention
				? mention.end
				: (() => {
						let urlEnd = index;
						while (urlEnd < input.length && !/\s|</.test(input[urlEnd] ?? "")) {
							urlEnd += 1;
						}
						return urlEnd;
					})();
			parts.push(input.slice(cursor, index));
			const token = input.slice(index, end);
			parts.push(
				<span className="font-semibold text-primary" key={`${index}-${token}`}>
					<span aria-hidden="true" className="mr-1 inline-flex align-[-2px]">
						{mention?.item?.icon ?? <IconWorld className="size-3.5" />}
					</span>
					{mention?.item ? `@${mention.item.label}` : token}
				</span>
			);
			cursor = end;
			index = end - 1;
		}
		if (cursor < input.length) {
			parts.push(input.slice(cursor));
		}
		return parts;
	}, [input, mentionItems]);

	const suggestionItems = Array.isArray(suggestions)
		? suggestions
		: (suggestions?.items ?? []);
	const suggestionsClassName = Array.isArray(suggestions)
		? undefined
		: suggestions?.className;
	const suggestionItemClassName = Array.isArray(suggestions)
		? undefined
		: suggestions?.itemClassName;

	// The textarea (or its typing-animation stand-in). It always sits in its own
	// padded block above the controls row; `compact` only tightens that block's
	// padding.
	//
	// While recording, the textarea is REPLACED (not overlaid) by a full-width
	// live waveform that fills the input slot — like ChatGPT. Swapping it out (vs
	// covering it) means text input is inherently disallowed (there is no textarea
	// to type into), the focus ring stays untouched, and the stop control in the
	// toolbar below/beside stays reachable. Any text already typed lives in `input`
	// state (not the DOM), so it reappears intact when recording stops.
	let inputContent: React.ReactNode;
	if (isTyping) {
		inputContent = (
			<div className="w-full text-[14px] text-muted-foreground leading-[1.6]">
				<span>{displayedText}</span>
				<span className="ml-px inline-block h-[1em] w-[2px] animate-an-blink bg-foreground align-text-bottom" />
			</div>
		);
	} else if (isRecording) {
		inputContent = (
			<Wave
				aria-label="Recording"
				barCount={RECORDING_WAVE_BARS}
				className="h-6 w-full text-primary"
				levels={voiceLevels}
			/>
		);
	} else {
		inputContent = (
			<div className="relative">
				{showComposerSuggestions &&
					placeholderSuggestion &&
					suggestionIndex < 0 && (
						<div className="pointer-events-none absolute inset-x-0 top-0 z-10 truncate text-[14px] text-muted-foreground/60 leading-[1.6]">
							{placeholderSuggestion}
							<span className="ml-2 rounded border px-1 text-[10px]">Tab</span>
						</div>
					)}
				{showComposerSuggestions && suggestionIndex >= 0 && (
					<div className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border bg-popover p-1 shadow-lg">
						{composerSuggestions.map((item, index) => (
							<button
								className={cn(
									"block w-full rounded px-2 py-1.5 text-left text-sm",
									index === suggestionIndex && "bg-accent"
								)}
								key={item.id}
								onClick={() => handleSuggestionSelect(item)}
								type="button"
							>
								{item.label}
							</button>
						))}
					</div>
				)}
				{input && (
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words text-[14px] text-foreground leading-[1.6]"
					>
						{renderComposerPreview()}
					</div>
				)}
				<textarea
					className={cn(
						"relative w-full resize-none border-0 bg-transparent text-transparent leading-[1.6] caret-foreground outline-none placeholder:text-muted-foreground",
						"overflow-hidden",
						disabled && "cursor-not-allowed opacity-50"
					)}
					disabled={disabled}
					onChange={(e) => {
						setSuggestionIndex(-1);
						setInput(e.target.value);
					}}
					onKeyDown={handleKeyDown}
					onPaste={onPaste}
					placeholder={effectivePlaceholder}
					ref={textareaRef}
					rows={1}
					value={input}
				/>
			</div>
		);
	}

	// The controls row (the "+", agent selector, voice/image, send), identical on
	// every surface and in both densities.
	const composerToolbar = (
		<ComposerToolbar
			contextMeter={contextMeter}
			contextMeterOnOpen={contextMeterOnOpen}
			directoryGroups={composerMenuGroups}
			directoryQuery={
				plusMenuQueryStart === null ? "" : input.slice(plusMenuQueryStart)
			}
			disabled={disabled}
			doubleCheckControls={doubleCheckControls}
			ghostControls={ghostControls}
			goalControls={goalControls}
			hasImageGen={Boolean(onGenerateImage)}
			hasInput={hasInput}
			hasVideoGen={Boolean(onGenerateVideo)}
			hasVoice={Boolean(voice)}
			isGeneratingImage={isGenerating}
			isGeneratingVideo={isGeneratingVideo}
			isRecording={isRecording}
			isStreaming={isStreaming}
			isTranscribing={isTranscribing}
			leftActions={leftActions}
			onAttach={onAttach}
			onDirectorySelect={(item) => {
				const start = plusMenuQueryStart ?? input.length;
				const prefix = input.slice(0, start).trimEnd();
				setInput(`${prefix}${prefix ? " " : ""}@${item.label} `);
				setPlusMenuQueryStart(null);
				onComposerMenuSelect?.(item);
			}}
			onGenerateImage={handleGenerateImage}
			onGenerateVideo={handleGenerateVideo}
			onMenuOpenChange={(open) => {
				setPlusMenuQueryStart(open ? input.length : null);
				if (open) {
					requestAnimationFrame(() => textareaRef.current?.focus());
				}
			}}
			onStartVoice={startVoice}
			onStop={onStop}
			onStopVoice={stopVoice}
			onSubmit={handleSubmit}
			pluginControls={pluginControls}
			rightActions={
				<>
					{draftControls && (
						<Popover>
							<PopoverTrigger asChild>
								<Button
									aria-label="Drafts"
									className="size-8"
									size="icon"
									variant="ghost"
								>
									<IconBookmark className="size-4" />
								</Button>
							</PopoverTrigger>
							<PopoverContent align="end" className="w-80 p-2">
								<div className="mb-1 px-2 py-1 font-medium text-sm">Drafts</div>
								{draftControls.items.length === 0 ? (
									<div className="px-2 py-3 text-muted-foreground text-sm">
										No drafts for this project
									</div>
								) : (
									draftControls.items.map((item) => (
										<div
											className="group flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted"
											key={item.id}
										>
											<button
												className="min-w-0 flex-1 truncate text-left text-sm"
												onClick={() => draftControls.onInsert(item.text)}
												type="button"
											>
												{item.preview}
											</button>
											<Button
												aria-label={`Delete ${item.preview}`}
												className="size-7 opacity-0 group-hover:opacity-100"
												onClick={() => draftControls.onDelete(item.id)}
												size="icon"
												variant="ghost"
											>
												<IconX className="size-3.5" />
											</Button>
										</div>
									))
								)}
							</PopoverContent>
						</Popover>
					)}
					{draftControls && (
						<Button
							aria-label="Save draft"
							className="size-8"
							disabled={!hasInput}
							onClick={() => {
								draftControls.onSave(input);
								setInput("");
							}}
							size="icon"
							variant="ghost"
						>
							<IconBookmark className="size-4" />
						</Button>
					)}
					{rightActions}
				</>
			}
			showAttach={showAttach}
			voiceDisabled={voice?.disabled}
			voiceMode={voiceMode}
		/>
	);

	return (
		<div className={cn("shrink-0 px-3 pb-3", className)}>
			<div className="mx-auto max-w-[720px]">
				{showTurnProgress ? (
					<div
						aria-live="polite"
						className="mb-2 flex justify-center text-[13px]"
					>
						<div className="inline-flex h-8 items-center rounded-full border border-border/70 bg-popover/95 px-1.5 text-muted-foreground shadow-sm backdrop-blur">
							{turnProgress?.plan ? (
								<Popover>
									<PopoverTrigger
										render={
											<button
												className="inline-flex h-7 items-center gap-1.5 rounded-full px-1.5 transition-colors hover:bg-muted"
												type="button"
											/>
										}
									>
										<IconLoader2 className="size-3.5 text-primary" />
										<span>
											Step {turnProgress.plan.current} /{" "}
											{turnProgress.plan.total}
										</span>
									</PopoverTrigger>
									<PopoverContent
										align="center"
										className="max-h-80 w-[min(30rem,calc(100vw-2rem))] gap-0 overflow-y-auto rounded-2xl p-2"
										side="top"
										sideOffset={8}
									>
										{turnProgress.plan.items.map((item, index) => {
											const PlanIcon =
												item.status === "completed"
													? IconCircleCheck
													: item.status === "in_progress"
														? IconLoader2
														: IconCircle;
											return (
												<div
													className="flex items-start gap-2 rounded-xl px-2 py-1.5 text-sm"
													key={`${index}-${item.label}`}
												>
													<PlanIcon
														className={cn(
															"mt-0.5 size-4 shrink-0",
															item.status === "in_progress" &&
																"animate-spin text-primary"
														)}
													/>
													<span>{item.label}</span>
												</div>
											);
										})}
									</PopoverContent>
								</Popover>
							) : null}
							{turnProgress?.plan && showChangeSummary ? (
								<span aria-hidden className="px-0.5 text-border">
									·
								</span>
							) : null}
							{showChangeSummary && effectiveChangeSummary ? (
								<Popover>
									<PopoverTrigger
										render={
											<button
												className="inline-flex h-7 items-center gap-1.5 rounded-full px-1.5 transition-colors hover:bg-muted"
												type="button"
											/>
										}
									>
										<span>
											<NumberRoll value={effectiveChangeSummary.files} /> file
											{effectiveChangeSummary.files === 1 ? "" : "s"} changed
										</span>
										<span className="font-medium text-emerald-600 dark:text-emerald-400">
											+
											<NumberRoll
												trend="up"
												value={effectiveChangeSummary.insertions}
											/>
										</span>
										<span className="font-medium text-red-600 dark:text-red-400">
											-
											<NumberRoll
												trend="down"
												value={effectiveChangeSummary.deletions}
											/>
										</span>
									</PopoverTrigger>
									{turnProgress?.files.length ? (
										<PopoverContent
											align="center"
											className="max-h-80 w-[min(24rem,calc(100vw-2rem))] gap-0 overflow-y-auto rounded-2xl p-1.5"
											side="top"
											sideOffset={8}
										>
											{turnProgress.files.map((file) => (
												<TurnProgressFile file={file} key={file.path} />
											))}
										</PopoverContent>
									) : null}
								</Popover>
							) : null}
						</div>
					</div>
				) : null}
				<div
					className={cn(
						"flex flex-col gap-0",
						// Reference architecture: the outer wrapper is the FRAME color
						// (distinct from the input box), so the bars — which carry no bg of
						// their own — show this color, and the sliver at the input box's
						// rounded corners is the same color as the bars (seamless).
						shouldShowInfoBar || goalBar || workspaceBar
							? "rounded-2xl bg-card"
							: null
					)}
				>
					{goalBar && <GoalBar {...goalBar} />}
					{ghostBarNode}
					{infoBarPosition === "top" && infoBarNode}
					{queueBarNode}
					{questionBarNode}
					{/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: custom drag/resize interaction */}
					<div
						className={cn(
							// No border/ring: the box is distinguished from the darker
							// `bg-card` frame (and its bars) purely by its lighter `bg-muted`
							// fill, so there is no ring on the textarea and no sliver.
							"composer-container relative cursor-text rounded-2xl bg-muted",
							// A drag-over ring always wins for the duration of the drag so
							// the drop target stays legible.
							isDragOver && "ring-2 ring-primary ring-inset"
						)}
						onClick={handleContainerClick}
					>
						{/* Composer header (e.g. pending quote preview), above the chips. */}
						{composerHeader}
						{/* Context items (attached images/files) */}
						<div
							className={cn(
								"grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-out",
								showContextItems && "grid-rows-[1fr]"
							)}
						>
							<div className="overflow-hidden">
								{showContextItems && (
									<div className="flex flex-wrap items-center gap-[6px] px-2.5 pt-2.5 pb-0.5">
										{attachedImages.map((img) => (
											<FileAttachment
												display={imageDisplayMode}
												enableImagePreview={enableImagePreview}
												filename={img.filename}
												id={img.id}
												isImage
												key={img.id}
												onRemove={
													onRemoveImage
														? () => onRemoveImage(img.id)
														: undefined
												}
												size={img.size}
												url={img.url}
											/>
										))}
										{attachedFiles.map((file) => (
											<FileAttachment
												filename={file.filename}
												id={file.id}
												key={file.id}
												onRemove={
													onRemoveFile ? () => onRemoveFile(file.id) : undefined
												}
												size={file.size}
											/>
										))}
									</div>
								)}
							</div>
						</div>

						{/* Typing animation image */}
						{isTyping && typingAnimation?.image && showImage && (
							<div className="flex flex-wrap gap-2 px-3 pt-3">
								<div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md">
									{/* biome-ignore lint/performance/noImgElement lint/correctness/useImageSize: dynamic remote logo URL */}
									<img
										alt=""
										className="h-full w-full object-cover"
										src={typingAnimation.image}
									/>
								</div>
							</div>
						)}

						{/* Text input or typing animation text. `compact` is purely this
						    block's density — it buys the transcript back some height once
						    a chat has history; the controls row below is the same on
						    every surface.

						    The roomy block CENTRES its content rather than pinning it with a
						    top pad: `pt-3` against a 56px floor put a 22px line 12px from the
						    top and left 22px of dead air under it, so the caret sat visibly
						    high in an apparently empty box. `justify-center` with symmetric
						    padding makes one line sit in the middle and a grown textarea
						    simply push the block taller — no fixed pad to re-tune when the
						    floor or the line-height changes. */}
						<div
							className={
								compact
									? "min-h-[40px] pt-2 pr-3 pb-0.5 pl-3"
									: "flex min-h-[56px] flex-col justify-center py-2 pr-3 pl-3.5"
							}
						>
							{inputContent}
						</div>

						{/* Controls row, INSIDE the composer box (Codex-style): the "+",
						    agent selector, voice/image, and send button all share the
						    textarea's rounded card and background. `compact` forces it on:
						    that layout always carried the send button, so a compact surface
						    wiring none of the optional controls must not lose it. */}
						{(compact ||
							leftActions ||
							rightActions ||
							showAttach ||
							voice ||
							voiceMode ||
							onGenerateImage ||
							onGenerateVideo ||
							goalControls ||
							ghostControls ||
							pluginControls?.length ||
							contextMeter) &&
							composerToolbar}
					</div>

					{suggestionItems.length > 0 && (
						<Suggestions
							className={cn("mt-4 px-3", suggestionsClassName)}
							disabled={disabled || isStreaming}
							itemClassName={suggestionItemClassName}
							items={suggestionItems}
							onSelect={handleSuggestionSelect}
						/>
					)}
					{infoBarPosition === "bottom" && infoBarNode}
					{/* Action bar (project ▸ branch ▸ worktree): full-width footer inside
					    the card, directly beneath the input — same slot as the bottom
					    info bar. */}
					{actionBarNode}
				</div>
			</div>
		</div>
	);
});
