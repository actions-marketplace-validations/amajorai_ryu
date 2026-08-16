import {
	Alert02Icon,
	ArrowDataTransferHorizontalIcon,
	ArrowDown02Icon,
	InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	type CitationItem,
	CitationList,
} from "@ryu/ui/components/agents/citations";
import { ReasoningText } from "@ryu/ui/components/agents/loading-states";
import { MessageScroller as BeuiMessageScroller } from "@ryu/ui/components/agents/message-scroller";
import { Bubble, BubbleContent } from "@ryu/ui/components/bubble";
import { Button } from "@ryu/ui/components/button";
import { Marker, MarkerContent, MarkerIcon } from "@ryu/ui/components/marker";
import {
	Message,
	MessageAvatar,
	MessageContent,
	MessageFooter,
	MessageHeader,
} from "@ryu/ui/components/message";
import {
	ImageGeneration,
	type ImageGenerationStatus,
} from "@ryu/ui/components/motion/image-generation.tsx";
import { Loader } from "@ryu/ui/components/motion/loader";
import type { PreviewRailItem } from "@ryu/ui/components/motion/preview-rail";
import {
	VideoGeneration,
	type VideoGenerationStatus,
} from "@ryu/ui/components/motion/video-generation.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@ryu/ui/components/tooltip";
import {
	formatDateTime,
	formatTime,
	startOfTodayMs,
	useTimezoneRevision,
} from "@ryu/ui/lib/timezone.ts";
import { cn } from "@ryu/ui/lib/utils";
import {
	IconCheck,
	IconChevronLeft,
	IconChevronRight,
	IconCopy,
	IconGitBranch,
	IconPencil,
	IconRefresh,
	IconThumbDown,
	IconThumbUp,
	IconVolume,
} from "@tabler/icons-react";
import type { ChatStatus, UIMessage } from "ai";
import type React from "react";
import {
	Fragment,
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useChatDisplayPrefs } from "./chat-display-prefs.tsx";
import type { ChatTocFileChange, ChatTocItem } from "./chat-toc.tsx";
import {
	dayLabel,
	groupTurnsByDay,
	separatorKeyByTurnIndex,
} from "./date-groups.ts";
import { DateSeparator } from "./date-separator.tsx";
import { ErrorMessage } from "./error-message.tsx";
import { FileTypeIcon } from "./file-type-icon.tsx";
import { FloatingDateHeader } from "./floating-date-header.tsx";
import { usePinnedUserMessage } from "./hooks/use-pinned-user-message.ts";
import { useTranscriptAnchor } from "./hooks/use-transcript-anchor.ts";
import type { LinkPreviewResolvers } from "./link-preview.tsx";
import { Markdown } from "./markdown.tsx";
import { isServerAssignedMessageId } from "./message-reaction-id.ts";
import type { MessageReactionBucket } from "./message-reactions.tsx";
import { AcpUsageStats, MessageStats } from "./message-stats.tsx";
import { PinnedUserMessageBar } from "./pinned-user-message-bar.tsx";
import { shouldShowPlanning } from "./planning-visibility.ts";
import { messageSelectableProps, SelectionQuoteToolbar } from "./quote.tsx";
import {
	hasVisibleContentAtNoDetail,
	isHiddenAtNoDetail,
} from "./tool-detail-visibility.ts";
import { ToolGroup } from "./tools/tool-group.tsx";
import { isToolActivityGroupCandidate } from "./tools/tool-grouping.ts";
import { ToolRenderer as DefaultToolRenderer } from "./tools/tool-renderer.tsx";
import {
	type AgentMessageContext,
	type AgentUiSubmit,
	type CustomToolRendererProps,
	type MentionItem,
	widgetMessageProvenanceKey,
} from "./types.ts";
import {
	MESSAGE_TIME_OPTIONS,
	MESSAGE_TOOLTIP_OPTIONS,
	UserMessage,
} from "./user-message.tsx";
import { extractCitations } from "./utils/citations.ts";
import { normalizeAssistantToolParts } from "./utils/tool-part-normalizer.ts";
import { WorkflowRunProgressCard } from "./workflow-run-part.tsx";

export interface MessageListProps {
	/**
	 * Avatar node shown beside each assistant turn (e.g. the active agent's
	 * logo, or a fanned stack of member logos for a team). When omitted, no
	 * avatar is rendered. Goes inside `MessageAvatar`.
	 */
	assistantAvatar?: React.ReactNode;
	/**
	 * Display name shown above each assistant turn (agent or team name). When
	 * omitted, no header is rendered.
	 */
	assistantName?: string;
	/**
	 * Marks for the agents currently working on the turn, drawn side by side in
	 * the live status row so a running turn says WHO is on it, not just that
	 * something is happening. Falls back to `assistantAvatar` when omitted, and
	 * to the spiral loader when there is no avatar at all.
	 */
	assistantPlanningAvatars?: React.ReactNode[];
	/** Agent identities used when an agent-comms tool becomes a transcript activity. */
	agentMessageContext?: AgentMessageContext;
	className?: string;
	classNames?: {
		userMessage?: string;
	};
	/**
	 * The active model's context window in tokens. When provided, a completed
	 * assistant turn shows a Twitter-style context-usage ring (tokens used vs
	 * this size) in its stats footer. Omitted ⇒ speed only, no ring.
	 */
	contextSize?: number;
	/**
	 * Identity of the thread being shown, used to fire the open-at-bottom jump
	 * once per conversation (see {@link ChatDisplayPrefs.openAtBottom}). Pass the
	 * conversation id when the surface has one — the fallback (the first
	 * message's id) also changes when history is rewritten, e.g. editing the
	 * opening user message mints a new id and would re-jump.
	 */
	conversationKey?: string;
	/**
	 * Current signed-in user info for displaying avatar/name on own messages.
	 */
	currentUser?: {
		avatar?: string;
		name?: string;
		id?: string;
	};
	/**
	 * When true (default) clicking an attached image in a user message opens
	 * the fullscreen lightbox preview. Set to false to disable previews.
	 */
	enableImagePreview?: boolean;
	/**
	 * Persisted thumbs state keyed by (assistant) message id. Only ids present here
	 * render a lit thumb; absent ids are unrated.
	 */
	feedback?: Record<string, "up" | "down">;
	/**
	 * A non-model notice about the THREAD rather than about a turn — "this
	 * conversation was imported", "history before this point was trimmed" — drawn
	 * as a `Marker` after the last message, with its optional actions as inline
	 * links.
	 *
	 * It lands as the final direct child of the scroller's Content, which is
	 * deliberate: it carries no `data-scroll-anchor`, so `firstAnchorAtOrAfter`
	 * skips it and appending it can never steal the scroll target from the user's
	 * next question.
	 */
	historyNotice?: {
		actions?: { label: string; onClick: () => void }[];
		description?: string;
		id: string;
		title: string;
	};
	/**
	 * Where to position the scroll container on initial mount.
	 * - "bottom" (default): classic chat behavior, pinned to the latest message.
	 * - "top": start from the top of the conversation — useful for static demos
	 *   or read-only transcripts where the user should read top-to-bottom.
	 */
	initialScrollBehavior?: "bottom" | "top";
	/** Resolved @ mentions used by user and assistant Markdown. */
	mentionItems?: MentionItem[];
	/** Contributed per-message toolbar actions (see {@link ContributedMessageAction}),
	 *  rendered after the built-ins. Filtered to the message's `target` by the shell. */
	messageActions?: ContributedMessageAction[];
	messages: UIMessage[];
	onAgentUiSubmit?: AgentUiSubmit;
	/**
	 * Branch ("fork into new chat") a message. When provided, a branch button is
	 * shown in each message's hover toolbar; clicking it calls this with the id of
	 * the message to branch from (history up to and including it is copied).
	 */
	onBranch?: (messageId: string) => void;
	/** Fire a contributed message action (see {@link ContributedMessageAction}). */
	onContributedMessageAction?: (
		action: ContributedMessageAction,
		value?: string
	) => void;
	/**
	 * Edit a previously-sent user message into a new version (ChatGPT/Claude-style
	 * branching). When provided, a pencil button appears in each user message's
	 * hover toolbar; clicking it turns the bubble into an inline editor. Saving
	 * calls this with the message id and new text.
	 */
	onEditMessage?: (messageId: string, newText: string) => void;
	/**
	 * Thumbs 👍/👎 on an assistant turn. When provided, thumbs buttons appear in
	 * each assistant turn's hover toolbar; clicking calls this with the turn's last
	 * message id, the new rating (`null` clears a previous vote), and whether this
	 * is the latest turn. The lit state is driven by `feedback` (persisted
	 * server-side).
	 */
	onFeedback?: (
		messageId: string,
		rating: "up" | "down" | null,
		isLatest: boolean
	) => void;
	/**
	 * Open a project file referenced by assistant output or tool summaries.
	 */
	onOpenFile?: (path: string) => void;
	onOpenLink?: (url: string) => void;
	/**
	 * Quote a text selection made inside a message. When provided, selecting text
	 * in any message surfaces a floating "Quote" button; clicking it calls this
	 * with the selected plain text (the surface stashes it as a pending composer
	 * quote). When omitted, no selection toolbar is shown.
	 */
	onQuote?: (text: string) => void;
	/**
	 * Regenerate an assistant reply as a new version. When provided, a refresh
	 * button appears in each assistant turn's hover toolbar; clicking it calls this
	 * with the last assistant message's id.
	 */
	onRegenerateMessage?: (messageId: string) => void;
	/**
	 * Re-run a failed inline media generation. Called with the assistant message
	 * holding the failed part, which of the two media surfaces it is, and the
	 * prompt that produced it — everything the producer needs to rewrite that same
	 * message in place. Distinct from `onRegenerateMessage`, which branches a
	 * PERSISTED turn server-side: these generation parts are client-only, so there
	 * is no server message to branch from. Without it, a failed generation shows
	 * no Retry.
	 */
	onRetryGeneration?: (
		messageId: string,
		kind: "image" | "video",
		prompt: string
	) => void;
	/**
	 * Switch the active version at a branch point. When a message has more than one
	 * version (see `versions`), a `< n / m >` pager renders; stepping it calls this
	 * with the target version's message id.
	 */
	onSelectVersion?: (versionId: string) => void;
	/**
	 * Speak an assistant turn aloud (text-to-speech). When provided, a speaker
	 * button is shown in each assistant turn's hover toolbar; clicking it calls
	 * this with the turn's combined text. When omitted, no speak button is shown.
	 */
	onSpeak?: (text: string) => void;
	/**
	 * Toggle an emoji reaction on a message. When provided, each user message
	 * grows a reaction chip row and an "add reaction" picker; without it the whole
	 * feature is absent, which is how surfaces that have no realtime room (the
	 * island, the storyboard) opt out.
	 */
	onToggleReaction?: (messageId: string, emoji: string) => void;
	onWorkflowResume?: (runId: string, payload: string) => Promise<unknown>;
	previewResolvers?: LinkPreviewResolvers;
	/**
	 * Reaction buckets keyed by message id, in Core's first-reaction order.
	 * Ordering is preserved rather than re-sorted so a chip row does not reshuffle
	 * under the reader's cursor as counts change.
	 */
	reactionsByMessage?: ReadonlyMap<string, readonly MessageReactionBucket[]>;
	showCopyToolbar?: boolean;
	slots?: {
		UserMessage?: React.ComponentType<{
			/** Hover actions for the turn. A custom UserMessage MUST render this
			 *  somewhere inside the bubble's column or the toolbar disappears. */
			actions?: React.ReactNode;
			message: UIMessage;
			className?: string;
			currentUser?: {
				avatar?: string;
				name?: string;
				id?: string;
			};
			enableImagePreview?: boolean;
			editing?: boolean;
			mentionItems?: MentionItem[];
			onEditSubmit?: (text: string) => void;
			onEditCancel?: () => void;
		}>;
	ToolRenderer?: React.ComponentType<ToolRendererProps>;
	};
	status: ChatStatus;
	suppressQuestionTool?: boolean;
	toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>;
	/**
	 * Version-pager data keyed by message id: the number of versions at this branch
	 * point, the active index, and the ordered sibling ids to step through. Only
	 * ids with `count > 1` render a pager.
	 */
	versions?: Record<string, { index: number; count: number; ids: string[] }>;
}

interface ToolPartBase {
	input?: unknown;
	output?: unknown;
	result?: unknown;
	state?: string;
	toolCallId?: string;
	type: string;
}

interface ToolRendererProps {
	agentMessageContext?: AgentMessageContext;
	chatStatus?: string;
	nestedTools?: ToolPartBase[];
	onAgentUiSubmit?: AgentUiSubmit;
	part: ToolPartBase;
	toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>;
}

function normalizeMessages(messages: UIMessage[]): UIMessage[] {
	let changed = false;
	const normalized = messages.map((message) => {
		if (Array.isArray(message.parts) && message.parts.length > 0) {
			return message;
		}
		const raw = message as { content?: string; text?: string };
		const content = raw.content ?? raw.text;
		if (typeof content !== "string" || !content) {
			return message;
		}
		changed = true;
		return {
			...message,
			parts: [{ type: "text", text: content }],
		} as UIMessage;
	});
	return changed ? normalized : messages;
}

// `hideToolDetail` is not a cosmetic argument here. At Detail level "None" a
// turn made only of tool calls renders NOTHING, so asking "does the last
// assistant message have content" against the raw parts would answer yes, drop
// the live "Thinking" row, and leave the transcript looking idle for the whole
// time the agent is actually working. The question has to be asked at the same
// detail level the transcript is drawing at.
function getLastAssistantHasContent(
	messages: UIMessage[],
	hideToolDetail: boolean
) {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const msg = messages[i];
		if (msg?.role !== "assistant") {
			continue;
		}
		const parts = msg.parts ?? [];
		if (hideToolDetail) {
			return hasVisibleContentAtNoDetail(parts);
		}
		return parts.some((part) => {
			if (isTextPart(part)) {
				return part.text.trim().length > 0;
			}
			return isV5ToolPart(part);
		});
	}
	return false;
}

/** What the live status row says the agent is doing right now. */
type PlanningActivity = "thinking" | "working" | "typing";

const PLANNING_LABELS: Record<PlanningActivity, string> = {
	thinking: "Thinking",
	working: "Working",
	typing: "Typing",
};

/**
 * Read the current activity off the last assistant message.
 *
 * The LAST part wins, because that is what the agent is doing NOW: a tool part
 * in final position means a call is the most recent thing it did ("Working"),
 * and text in final position means tokens are landing ("Typing"). An opened turn
 * with neither is still "Thinking".
 *
 * Deliberately not keyed on a tool part's `state`: a completed call followed by
 * nothing else still reads as work in progress, since the turn has not settled —
 * the row only exists while `isStreaming`.
 */
function getPlanningActivity(messages: UIMessage[]): PlanningActivity {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const msg = messages[i];
		if (msg?.role !== "assistant") {
			continue;
		}
		const parts = msg.parts ?? [];
		for (let p = parts.length - 1; p >= 0; p -= 1) {
			// `unknown`, deliberately: `isV5ToolPart` narrows the union so far that
			// the following `isTextPart` sees `never` and its guard stops compiling.
			// Both predicates already validate the shape they claim.
			const part: unknown = parts[p];
			if (isV5ToolPart(part)) {
				return "working";
			}
			if (isTextPart(part) && part.text.trim().length > 0) {
				return "typing";
			}
		}
		return "thinking";
	}
	return "thinking";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** `https://www.example.com/x` → `example.com`, for a citation's domain line. */
function hostnameOfCitation(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

function isTextPart(part: unknown): part is { type: "text"; text: string } {
	return (
		isRecord(part) && part.type === "text" && typeof part.text === "string"
	);
}

function isErrorPart(
	part: unknown
): part is { type: "error"; title?: string; message: string } {
	return (
		isRecord(part) && part.type === "error" && typeof part.message === "string"
	);
}

/**
 * An assistant image part — a standard AI SDK `file` part whose media type is an
 * image, carrying a `url` (a data: URL for generated images, or a remote URL).
 * Generated images are appended in this exact shape (see ChatPage's
 * handleGenerateImage), so the producer and this consumer agree.
 */
function getAssistantImageUrl(part: unknown): string | null {
	if (!isRecord(part) || part.type !== "file") {
		return null;
	}
	const filePart = part as {
		mediaType?: string;
		mimeType?: string;
		url?: string;
		data?: string;
	};
	const media = filePart.mediaType ?? filePart.mimeType;
	if (!media?.startsWith("image/")) {
		return null;
	}
	if (filePart.url) {
		return filePart.url;
	}
	if (filePart.data) {
		return `data:${media};base64,${filePart.data}`;
	}
	return null;
}

/** Longest edge, in px, a generated image occupies in the transcript. */
const MAX_IMAGE_EDGE = 360;

const IMAGE_GENERATION_STATUSES = new Set<ImageGenerationStatus>([
	"queued",
	"generating",
	"refining",
	"complete",
	"error",
]);

export interface ImageGenerationPartData {
	/** The prompt that produced it, shown under the frame. */
	prompt?: string;
	/** Where the generation is: `generating` while Core is working, then
	 *  `complete` (with `url`) or `error` (with `statusText` = the reason). */
	status: ImageGenerationStatus;
	/** Overrides the component's stock status line — used to surface the engine's
	 *  own error text instead of a generic "Generation failed". */
	statusText?: string;
	/** The finished image, once there is one. */
	url?: string;
}

/**
 * A client-only image-generation part — the *in-flight* half of an inline
 * `/api/images/generate` turn. The producer (ChatPage / AssistantPanel) appends
 * this the moment generation starts and rewrites the same message in place when
 * the engine answers, so the frame is reserved up front and the finished image
 * fades in with no layout shift. Producer and consumer agree on this exact
 * shape, same as the `file`-part contract above.
 */
function getImageGenerationPart(part: unknown): ImageGenerationPartData | null {
	if (!isRecord(part) || part.type !== "data-image-generation") {
		return null;
	}
	const data = isRecord(part.data) ? part.data : {};
	const status =
		typeof data.status === "string" &&
		IMAGE_GENERATION_STATUSES.has(data.status as ImageGenerationStatus)
			? (data.status as ImageGenerationStatus)
			: "generating";
	return {
		prompt: typeof data.prompt === "string" ? data.prompt : undefined,
		status,
		statusText:
			typeof data.statusText === "string" ? data.statusText : undefined,
		url: typeof data.url === "string" ? data.url : undefined,
	};
}

/**
 * The one inline surface for a generated image, in both its pending and its
 * finished state. The frame is square until the image reports its own
 * dimensions, then takes the real aspect ratio — with `object-contain` so a
 * non-square generation (`size: "512x768"`) is never cropped.
 *
 * `showStatus` is off for images that merely *arrive* as `file` parts (pasted,
 * or streamed by Core): those get the same frame, without a status line
 * describing work that never happened here.
 */
function AssistantGeneratedImage({
	onRetry,
	prompt,
	showStatus,
	status,
	statusText,
	url,
}: ImageGenerationPartData & {
	onRetry?: () => void;
	showStatus: boolean;
}) {
	const [size, setSize] = useState<{ height: number; width: number } | null>(
		null
	);

	const handleLoad = useCallback(
		(event: React.SyntheticEvent<HTMLImageElement>) => {
			const { naturalHeight, naturalWidth } = event.currentTarget;
			if (naturalWidth > 0 && naturalHeight > 0) {
				setSize({ height: naturalHeight, width: naturalWidth });
			}
		},
		[]
	);

	// The frame is square until the image reports its own dimensions. A portrait
	// generation then narrows rather than growing tall, so BOTH edges stay within
	// the transcript's 360px budget (the old render capped height the same way).
	const maxWidth =
		size && size.height > size.width
			? Math.round(MAX_IMAGE_EDGE * (size.width / size.height))
			: MAX_IMAGE_EDGE;

	return (
		<div className="w-full" style={{ maxWidth }}>
			<ImageGeneration
				aspectRatio={size ? `${size.width} / ${size.height}` : "1 / 1"}
				mediaClassName="[&>*]:object-contain [&_img]:object-contain"
				onRetry={onRetry}
				prompt={prompt}
				// Only ever the image's real dimensions — nothing is claimed before
				// the engine has actually produced something.
				resolution={size ? `${size.width} × ${size.height}` : undefined}
				showStatus={showStatus}
				size="fluid"
				status={status}
				statusText={statusText}
			>
				{url ? (
					<img
						alt={prompt ?? "Generated image"}
						onLoad={handleLoad}
						src={url}
					/>
				) : null}
			</ImageGeneration>
		</div>
	);
}

const VIDEO_GENERATION_STATUSES = new Set<VideoGenerationStatus>([
	"queued",
	"generating",
	"rendering",
	"complete",
	"error",
]);

export interface VideoGenerationPartData {
	/** A still to hold the frame while the clip buffers, when the engine gave one. */
	poster?: string;
	/** The prompt that produced it, shown under the frame. */
	prompt?: string;
	/** Where the generation is: `generating` while Core is working, then
	 *  `complete` (with `url`) or `error` (with `statusText` = the reason). */
	status: VideoGenerationStatus;
	/** Overrides the component's stock status line — used to surface the engine's
	 *  own error text instead of a generic "Generation failed". */
	statusText?: string;
	/** The finished clip, once there is one. */
	url?: string;
}

/**
 * A client-only video-generation part — the video twin of
 * {@link getImageGenerationPart}, produced by ChatPage's handleGenerateVideo in
 * this exact shape. Same contract, same in-place rewrite when the engine
 * answers.
 */
function getVideoGenerationPart(part: unknown): VideoGenerationPartData | null {
	if (!isRecord(part) || part.type !== "data-video-generation") {
		return null;
	}
	const data = isRecord(part.data) ? part.data : {};
	const status =
		typeof data.status === "string" &&
		VIDEO_GENERATION_STATUSES.has(data.status as VideoGenerationStatus)
			? (data.status as VideoGenerationStatus)
			: "generating";
	return {
		poster: typeof data.poster === "string" ? data.poster : undefined,
		prompt: typeof data.prompt === "string" ? data.prompt : undefined,
		status,
		statusText:
			typeof data.statusText === "string" ? data.statusText : undefined,
		url: typeof data.url === "string" ? data.url : undefined,
	};
}

const SECONDS_PER_MINUTE = 60;

/** `4.2` → `"0:04"`. Only ever called with a duration the element reported. */
function formatClipDuration(seconds: number): string {
	const whole = Math.round(seconds);
	const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
	const rest = whole % SECONDS_PER_MINUTE;
	return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/**
 * The one inline surface for a generated video, in both its pending and its
 * finished state — the twin of {@link AssistantGeneratedImage}. The frame is
 * 16/9 until the clip reports its own dimensions on `loadedmetadata`, which is
 * also where the duration badge comes from; nothing is claimed before the
 * element has actually measured the media.
 *
 * `showStatus` is off for clips that merely *arrive* as `file` parts, exactly as
 * for images: same frame, no status line describing work that never happened.
 */
function AssistantGeneratedVideo({
	onRetry,
	poster,
	prompt,
	showStatus,
	status,
	statusText,
	url,
}: VideoGenerationPartData & {
	onRetry?: () => void;
	showStatus: boolean;
}) {
	const [meta, setMeta] = useState<{
		duration: number;
		height: number;
		width: number;
	} | null>(null);

	const handleLoadedMetadata = useCallback(
		(event: React.SyntheticEvent<HTMLVideoElement>) => {
			const { duration, videoHeight, videoWidth } = event.currentTarget;
			if (videoWidth > 0 && videoHeight > 0) {
				setMeta({
					duration: Number.isFinite(duration) ? duration : 0,
					height: videoHeight,
					width: videoWidth,
				});
			}
		},
		[]
	);

	// Same budget as the image frame: a portrait clip narrows rather than growing
	// tall, so BOTH edges stay within the transcript's 360px allowance.
	const maxWidth =
		meta && meta.height > meta.width
			? Math.round(MAX_IMAGE_EDGE * (meta.width / meta.height))
			: MAX_IMAGE_EDGE;

	return (
		<div className="w-full" style={{ maxWidth }}>
			<VideoGeneration
				aspectRatio={meta ? `${meta.width} / ${meta.height}` : "16 / 9"}
				duration={
					meta && meta.duration > 0
						? formatClipDuration(meta.duration)
						: undefined
				}
				mediaClassName="[&>*]:object-contain [&_video]:object-contain"
				onRetry={onRetry}
				poster={poster}
				prompt={prompt}
				showStatus={showStatus}
				size="fluid"
				status={status}
				statusText={statusText}
			>
				{url ? (
					// biome-ignore lint/a11y/useMediaCaption: a generated clip has no caption track
					<video
						aria-label={prompt ?? "Generated video"}
						controls
						onLoadedMetadata={handleLoadedMetadata}
						playsInline
						poster={poster}
						preload="metadata"
						src={url}
					>
						<a href={url}>Download video</a>
					</video>
				) : null}
			</VideoGeneration>
		</div>
	);
}

/**
 * An assistant video part — the `file`-part twin of {@link getAssistantImageUrl},
 * so a clip that merely arrives (streamed by Core, or the extra clips of a
 * multi-clip generation) gets the same reserved frame and a real player instead
 * of a download link.
 */
function getAssistantVideoUrl(part: unknown): string | null {
	if (!isRecord(part) || part.type !== "file") {
		return null;
	}
	const filePart = part as {
		mediaType?: string;
		mimeType?: string;
		url?: string;
		data?: string;
	};
	const media = filePart.mediaType ?? filePart.mimeType;
	if (!media?.startsWith("video/")) {
		return null;
	}
	if (filePart.url) {
		return filePart.url;
	}
	if (filePart.data) {
		return `data:${media};base64,${filePart.data}`;
	}
	return null;
}

/**
 * A NON-image, NON-video assistant `file` part (audio, or any other mime),
 * resolved to a playable/downloadable url + its media type. Images and videos
 * are handled separately by {@link getAssistantImageUrl} and
 * {@link getAssistantVideoUrl}; this covers the rest so inline audio (and other
 * attachments Core streams) isn't silently dropped.
 */
function getAssistantFileMeta(
	part: unknown
): { media: string; url: string } | null {
	if (!isRecord(part) || part.type !== "file") {
		return null;
	}
	const filePart = part as {
		mediaType?: string;
		mimeType?: string;
		url?: string;
		data?: string;
	};
	const media = filePart.mediaType ?? filePart.mimeType;
	if (!media || media.startsWith("image/") || media.startsWith("video/")) {
		return null;
	}
	if (filePart.url) {
		return { url: filePart.url, media };
	}
	if (filePart.data) {
		return { url: `data:${media};base64,${filePart.data}`, media };
	}
	return null;
}

function isV5ToolPart(part: unknown): part is ToolPartBase {
	if (!isRecord(part)) {
		return false;
	}
	const partType = part.type;
	return (
		partType === "dynamic-tool" ||
		(typeof partType === "string" && partType.startsWith("tool-"))
	);
}

/**
 * A `data-tool-widget-available` stream part — the live app widget Core mints for
 * a completed tool call. Not a v5 tool part; its payload is nested under `.data`
 * (D6) and carries the shared `toolCallId` that ties it to its tool row.
 */
function isWidgetAvailablePart(part: unknown): part is {
	type: "data-tool-widget-available";
	data: { toolCallId?: string };
} {
	return isRecord(part) && part.type === "data-tool-widget-available";
}

function getTextFromParts(parts: unknown[], joiner: string): string {
	return parts
		.filter(isTextPart)
		.map((part) => part.text)
		.join(joiner);
}

/** Collect unique file paths touched by Edit/Write/Read tool parts in a turn. */
function getChangedFilesFromParts(parts: unknown[]): ChatTocFileChange[] {
	const seen = new Set<string>();
	const files: ChatTocFileChange[] = [];
	for (const part of parts) {
		if (!isV5ToolPart(part)) {
			continue;
		}
		// Read once into a local and let `typeof` narrow it, instead of testing
		// one cast and then re-asserting a second, incompatible one — the old
		// `part as { toolName: string }` did not overlap `ToolPartBase` at all.
		const rawToolName = (part as { toolName?: unknown }).toolName;
		const toolName =
			typeof rawToolName === "string"
				? rawToolName
				: typeof part.type === "string" && part.type.startsWith("tool-")
					? part.type.slice("tool-".length)
					: "";
		if (!/^(Edit|Write|Read)$/i.test(toolName)) {
			continue;
		}
		const input = isRecord((part as { input?: unknown }).input)
			? (part as { input: Record<string, unknown> }).input
			: {};
		const output = (part as { output?: unknown }).output;
		const pathRaw =
			typeof input.file_path === "string"
				? input.file_path
				: isRecord(output) && typeof output.path === "string"
					? output.path
					: null;
		if (!pathRaw || seen.has(pathRaw)) {
			continue;
		}
		seen.add(pathRaw);
		const name = pathRaw.split(/[\\/]/).pop() ?? pathRaw;
		files.push({ name });
	}
	return files;
}

const MAX_PREVIEW_FILES = 4;

/**
 * The rich card the beUI rail shows while hovering a tick. Reuses the exact
 * content of the old left-gutter ChatToc popover — user prompt, agent mark +
 * reply excerpt, files changed — so switching navigation from the bespoke TOC
 * to the beUI PreviewRail keeps every fact, just in a beUI surface.
 */
function ChatRailPreview({ item }: { item: PreviewRailItem }) {
	const toc = item.data as ChatTocItem | undefined;
	if (!toc) {
		return (
			<div
				className="w-full rounded-2xl border border-border bg-card p-3 shadow-sm"
				data-slot="preview-rail-card"
			>
				<p
					className="font-medium text-card-foreground text-xs"
					data-slot="preview-rail-title"
				>
					{item.label}
				</p>
			</div>
		);
	}
	const extraFiles = (toc.files?.length ?? 0) - MAX_PREVIEW_FILES;
	return (
		<div
			className="w-full rounded-2xl border border-border bg-card p-3 shadow-sm"
			data-slot="preview-rail-card"
		>
			<p
				className="line-clamp-2 font-medium text-card-foreground text-xs leading-4"
				data-slot="preview-rail-title"
			>
				{toc.title}
			</p>
			{(toc.description || toc.agentAvatar) && (
				<div className="mt-1.5 flex items-start gap-1.5">
					{toc.agentAvatar ? (
						<span className="mt-0.5 flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
							{toc.agentAvatar}
						</span>
					) : null}
					{toc.agentName ? (
						<p className="mb-0.5 text-[10px] text-muted-foreground leading-3">
							{toc.agentName}
						</p>
					) : null}
					{toc.description ? (
						<p
							className="line-clamp-2 text-[11px] text-muted-foreground leading-4"
							data-slot="preview-rail-description"
						>
							{toc.description}
						</p>
					) : null}
				</div>
			)}
			{toc.files && toc.files.length > 0 ? (
				<div className="mt-1.5 border-border/60 border-t pt-1.5">
					<ul className="flex flex-col gap-0.5">
						{toc.files.slice(0, MAX_PREVIEW_FILES).map((file) => (
							<li
								className="flex min-w-0 items-baseline justify-between gap-2"
								key={file.name}
							>
								<span className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[10px] leading-3">
									<FileTypeIcon className="size-3.5" path={file.name} />
									{file.name}
								</span>
								{file.stats ? (
									<span className="shrink-0 text-[9px] text-muted-foreground tabular-nums">
										{file.stats}
									</span>
								) : null}
							</li>
						))}
					</ul>
					{extraFiles > 0 ? (
						<p className="mt-0.5 text-[9px] text-muted-foreground">
							+{extraFiles} more
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function CopyButton({
	text,
	onCopied,
}: {
	text: string;
	onCopied?: () => void;
}) {
	const [copied, setCopied] = useState(false);
	const copiedTimerRef = useRef<number | null>(null);

	const handleCopy = () => {
		navigator.clipboard.writeText(text);
		setCopied(true);
		if (copiedTimerRef.current) {
			window.clearTimeout(copiedTimerRef.current);
		}
		copiedTimerRef.current = window.setTimeout(() => {
			setCopied(false);
			copiedTimerRef.current = null;
		}, 2000);
		onCopied?.();
	};
	return (
		<Button
			className={cn("size-6 rounded-md opacity-50 hover:opacity-100")}
			onClick={handleCopy}
			onMouseDown={(event) => event.stopPropagation()}
			onPointerDown={(event) => {
				event.stopPropagation();
			}}
			size="icon"
			tabIndex={-1}
			type="button"
			variant="ghost"
		>
			<div className="relative h-3.5 w-3.5">
				<IconCopy
					className={cn(
						"absolute inset-0 h-3.5 w-3.5 text-muted-foreground transition-[opacity,transform] duration-150 ease-out",
						copied ? "scale-50 opacity-0" : "scale-100 opacity-100"
					)}
				/>
				<IconCheck
					className={cn(
						"absolute inset-0 h-3.5 w-3.5 text-muted-foreground transition-[opacity,transform] duration-150 ease-out",
						copied ? "scale-100 opacity-100" : "scale-50 opacity-0"
					)}
				/>
			</div>
		</Button>
	);
}

// Restore a checkpoint: forks a new chat from this point (history up to and
// including this message is copied), leaving the original thread intact. The
// bookmark affordance mirrors the AI SDK "Checkpoint" element over Ryu's
// existing non-destructive fork.
function BranchButton({ onBranch }: { onBranch: () => void }) {
	return (
		<Button
			aria-label="Restore checkpoint"
			className={cn("size-6 rounded-md opacity-50 hover:opacity-100")}
			onClick={onBranch}
			onMouseDown={(event) => event.stopPropagation()}
			onPointerDown={(event) => {
				event.stopPropagation();
			}}
			size="icon"
			tabIndex={-1}
			title="Restore checkpoint (branch a new chat from here)"
			type="button"
			variant="ghost"
		>
			<IconGitBranch className="h-3.5 w-3.5 text-muted-foreground" />
		</Button>
	);
}

function SpeakButton({ onSpeak }: { onSpeak: () => void }) {
	const [speaking, setSpeaking] = useState(false);
	const handleSpeak = async () => {
		if (speaking) {
			return;
		}
		setSpeaking(true);
		try {
			await onSpeak();
		} finally {
			setSpeaking(false);
		}
	};
	return (
		<Button
			aria-label="Speak reply"
			className={cn("size-6 rounded-md opacity-50 hover:opacity-100")}
			disabled={speaking}
			onClick={() => {
				handleSpeak().catch(() => undefined);
			}}
			onMouseDown={(event) => event.stopPropagation()}
			onPointerDown={(event) => {
				event.stopPropagation();
			}}
			size="icon"
			tabIndex={-1}
			title="Speak reply"
			type="button"
			variant="ghost"
		>
			<IconVolume
				className={cn(
					"h-3.5 w-3.5 text-muted-foreground",
					speaking && "text-primary"
				)}
			/>
		</Button>
	);
}

// Edit a previously-sent user message (ChatGPT/Claude-style): turns the bubble
// into an inline editor. The actual editing UI lives in UserMessage; this just
// requests entry into edit mode.
function EditButton({ onEdit }: { onEdit: () => void }) {
	return (
		<Button
			aria-label="Edit message"
			className={cn("size-6 rounded-md opacity-50 hover:opacity-100")}
			onClick={onEdit}
			onMouseDown={(event) => event.stopPropagation()}
			onPointerDown={(event) => {
				event.stopPropagation();
			}}
			size="icon"
			tabIndex={-1}
			title="Edit message"
			type="button"
			variant="ghost"
		>
			<IconPencil className="h-3.5 w-3.5 text-muted-foreground" />
		</Button>
	);
}

// Regenerate an assistant reply as a new version.
function RegenerateButton({ onRegenerate }: { onRegenerate: () => void }) {
	return (
		<Button
			aria-label="Regenerate reply"
			className={cn("size-6 rounded-md opacity-50 hover:opacity-100")}
			onClick={onRegenerate}
			onMouseDown={(event) => event.stopPropagation()}
			onPointerDown={(event) => {
				event.stopPropagation();
			}}
			size="icon"
			tabIndex={-1}
			title="Regenerate reply"
			type="button"
			variant="ghost"
		>
			<IconRefresh className="h-3.5 w-3.5 text-muted-foreground" />
		</Button>
	);
}

// `< n / m >` version pager shown when a turn has alternate versions. Stepping
// left/right calls `onSelect` with the target version's id.
function VersionPager({
	index,
	count,
	ids,
	alignClass,
	onSelect,
}: {
	index: number;
	count: number;
	ids: string[];
	alignClass: string;
	onSelect: (versionId: string) => void;
}) {
	const go = (delta: number) => {
		const next = index + delta;
		const target = ids[next];
		if (target) {
			onSelect(target);
		}
	};
	return (
		<div
			className={cn(
				"flex items-center gap-0.5 text-muted-foreground/70 text-xs",
				alignClass
			)}
			onMouseDown={(event) => event.stopPropagation()}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<Button
				aria-label="Previous version"
				className="size-5 rounded-md opacity-60 hover:opacity-100 disabled:opacity-25"
				disabled={index <= 0}
				onClick={() => go(-1)}
				size="icon"
				tabIndex={-1}
				type="button"
				variant="ghost"
			>
				<IconChevronLeft className="h-3.5 w-3.5" />
			</Button>
			<span className="tabular-nums">
				{index + 1}/{count}
			</span>
			<Button
				aria-label="Next version"
				className="size-5 rounded-md opacity-60 hover:opacity-100 disabled:opacity-25"
				disabled={index >= count - 1}
				onClick={() => go(1)}
				size="icon"
				tabIndex={-1}
				type="button"
				variant="ghost"
			>
				<IconChevronRight className="h-3.5 w-3.5" />
			</Button>
		</div>
	);
}

// Thumbs 👍/👎 on an assistant reply. Clicking the active rating again clears it
// (toggle); the lit state is driven by `rating` (persisted server-side), so it
// survives reloads. The vote seeds the learning + memory sinks in Core.
type FeedbackRating = "up" | "down";

/** A presentational per-message toolbar action contributed by an enabled plugin
 *  (`contributes.message_actions`), as served by `GET /api/plugins/contributions`
 *  and tagged with its owning `plugin`. Blocks stays presentational: the shell
 *  resolves the feed and passes resolved actions in; blocks never fetches. */
export interface ContributedMessageAction {
	/** Capability the shell dispatches when the action fires (never inline code). */
	capability?: string;
	icon?: string;
	id: string;
	kind: string;
	label: string;
	/** The owning plugin's manifest id (tagged by Core). */
	plugin: string;
	/** For `toggle-group`: `{ value, label, icon?, active_icon? }[]`. */
	states?: {
		active_icon?: string;
		icon?: string;
		label: string;
		value: string;
	}[];
	/** Which messages the action attaches to (`assistant` | `user` | `any`). */
	target: string;
}

/** One state button of a contributed `toggle-group` message action. Rendered
 *  exactly like the built-in thumbs: the active state is lit by `activeValue` and
 *  clicking the active state again clears it. */
function ContributedToggleGroupButtons({
	action,
	activeValue,
	onSelect,
}: {
	action: ContributedMessageAction;
	activeValue?: string;
	onSelect: (value: string) => void;
}) {
	if (!action.states || action.states.length === 0) {
		return null;
	}
	return (
		<>
			{action.states.map((state) => {
				const active = activeValue === state.value;
				return (
					<Button
						aria-label={state.label}
						aria-pressed={active}
						className={cn(
							"size-6 rounded-md opacity-50 hover:opacity-100",
							active && "opacity-100"
						)}
						key={state.value}
						onClick={() => onSelect(state.value)}
						onMouseDown={(event) => event.stopPropagation()}
						onPointerDown={(event) => {
							event.stopPropagation();
						}}
						size="icon"
						tabIndex={-1}
						title={state.label}
						type="button"
						variant="ghost"
					>
						{state.label}
					</Button>
				);
			})}
		</>
	);
}

function FeedbackButtons({
	rating,
	onFeedback,
}: {
	rating?: FeedbackRating;
	onFeedback: (next: FeedbackRating | null) => void;
}) {
	const vote = (value: FeedbackRating) => {
		onFeedback(rating === value ? null : value);
	};
	return (
		<>
			<Button
				aria-label="Good response"
				aria-pressed={rating === "up"}
				className={cn(
					"size-6 rounded-md opacity-50 hover:opacity-100",
					rating === "up" && "opacity-100"
				)}
				onClick={() => vote("up")}
				onMouseDown={(event) => event.stopPropagation()}
				onPointerDown={(event) => {
					event.stopPropagation();
				}}
				size="icon"
				tabIndex={-1}
				title="Good response"
				type="button"
				variant="ghost"
			>
				<IconThumbUp
					className={cn(
						"h-3.5 w-3.5 text-muted-foreground",
						rating === "up" && "fill-current text-primary"
					)}
				/>
			</Button>
			<Button
				aria-label="Bad response"
				aria-pressed={rating === "down"}
				className={cn(
					"size-6 rounded-md opacity-50 hover:opacity-100",
					rating === "down" && "opacity-100"
				)}
				onClick={() => vote("down")}
				onMouseDown={(event) => event.stopPropagation()}
				onPointerDown={(event) => {
					event.stopPropagation();
				}}
				size="icon"
				tabIndex={-1}
				title="Bad response"
				type="button"
				variant="ghost"
			>
				<IconThumbDown
					className={cn(
						"h-3.5 w-3.5 text-muted-foreground",
						rating === "down" && "fill-current text-destructive"
					)}
				/>
			</Button>
		</>
	);
}

function MessageToolbar({
	text,
	heightClass,
	hoverClass,
	isVisible,
	alignClass,
	onCopied,
	onBranch,
	onEdit,
	onRegenerate,
	onSpeak,
	feedbackRating,
	onFeedback,
	contributedActions,
	onContributedAction,
}: {
	text?: string;
	heightClass: string;
	hoverClass: string;
	isVisible: boolean;
	alignClass: string;
	onCopied?: () => void;
	onBranch?: () => void;
	onEdit?: () => void;
	onRegenerate?: () => void;
	onSpeak?: () => void;
	feedbackRating?: FeedbackRating;
	onFeedback?: (next: FeedbackRating | null) => void;
	/** Contributed per-message actions rendered AFTER the built-ins. The shell
	 *  resolves `contributes.message_actions` from the feed and passes them in;
	 *  blocks never fetches. */
	contributedActions?: ContributedMessageAction[];
	onContributedAction?: (
		action: ContributedMessageAction,
		value?: string
	) => void;
}) {
	return (
		<div
			className={cn(
				"pointer-events-none flex items-center gap-1 text-muted-foreground/70 text-xs opacity-0 transition-opacity duration-100",
				heightClass,
				alignClass,
				hoverClass,
				isVisible && "pointer-events-auto opacity-100"
			)}
			data-slot="message-toolbar"
			onMouseDown={(event) => event.stopPropagation()}
			onPointerDown={(event) => event.stopPropagation()}
		>
			{text && <CopyButton onCopied={onCopied} text={text} />}
			{onEdit && <EditButton onEdit={onEdit} />}
			{onRegenerate && <RegenerateButton onRegenerate={onRegenerate} />}
			{onBranch && <BranchButton onBranch={onBranch} />}
			{onSpeak && <SpeakButton onSpeak={onSpeak} />}
			{onFeedback && (
				<FeedbackButtons onFeedback={onFeedback} rating={feedbackRating} />
			)}
			{contributedActions?.map((action) =>
				action.kind === "toggle-group" ? (
					<ContributedToggleGroupButtons
						action={action}
						activeValue={feedbackRating}
						key={action.id}
						onSelect={(value) => onContributedAction?.(action, value)}
					/>
				) : (
					<Button
						aria-label={action.label}
						className="size-6 rounded-md opacity-50 hover:opacity-100"
						key={action.id}
						onClick={() => onContributedAction?.(action)}
						onMouseDown={(event) => event.stopPropagation()}
						onPointerDown={(event) => {
							event.stopPropagation();
						}}
						size="icon"
						tabIndex={-1}
						title={action.label}
						type="button"
						variant="ghost"
					>
						{action.label}
					</Button>
				)
			)}
		</div>
	);
}

/** One user message plus every assistant message that answered it. */
interface AssistantTurn {
	assistantMsgs: UIMessage[];
	userMsg?: UIMessage;
}

/**
 * Module-level so the "nothing is hidden" branch hands back a stable identity —
 * a fresh empty Set would change the memo's result on every render and defeat
 * it.
 */
const EMPTY_TURN_SET: ReadonlySet<AssistantTurn> = new Set<AssistantTurn>();

/**
 * The human sentence off a `data-ryu-failover` part, or `null` for anything
 * else.
 *
 * Emitted by Core's reactive-failover wrapper
 * (`apps/core/src/sidecar/adapters/mod.rs`) when a turn fails because a
 * subscription window is spent: which plan had room, what was done about it, and
 * when the window reopens. The `kind: "stand"` verdict — "the failure was not a
 * cap" — is never sent, so a part that arrives always carries a note.
 */
function getFailoverNote(part: unknown): string | null {
	if (!isRecord(part) || part.type !== "data-ryu-failover") {
		return null;
	}
	const data = part.data;
	if (!isRecord(data)) {
		return null;
	}
	const note = data.note;
	return typeof note === "string" && note.trim().length > 0
		? note.trim()
		: null;
}

/** True for a `data-ryu-workflow` part — the live checklist Core streams while
 *  a `workflow_id` chat turn runs. */
function isWorkflowRunPart(part: unknown): boolean {
	return isRecord(part) && part.type === "data-ryu-workflow";
}

/**
 * Was this turn cut off before it finished?
 *
 * `_interrupted` is stamped by the history mapper
 * (`apps/desktop/src/lib/chat-history-hydrate.ts`) off Core's server-side
 * `messages.interrupted` column, which is reconciled at boot. It rides on the
 * message object rather than in `parts`, which is the whole point: the marker is
 * metadata about the run, so it can never be copied out with the reply, replayed
 * to the model, or mistaken for something the agent said.
 */
function isInterruptedMessage(msg: UIMessage): boolean {
	return (msg as { _interrupted?: boolean })._interrupted === true;
}

/** Group flat messages into turns (user message + following assistant messages) */
function groupMessagesIntoTurns(messages: UIMessage[]): AssistantTurn[] {
	const turns: AssistantTurn[] = [];
	let current: AssistantTurn | null = null;

	for (const msg of messages) {
		if (msg.role === "user") {
			if (current) {
				turns.push(current);
			}
			current = { userMsg: msg, assistantMsgs: [] };
		} else if (msg.role === "assistant") {
			if (!current) {
				current = { assistantMsgs: [] };
			}
			current.assistantMsgs.push(msg);
		}
	}
	if (current) {
		turns.push(current);
	}
	return turns;
}

/**
 * Jumps the transcript to the newest message once per conversation.
 *
 * The scroller positions itself at the end when content first arrives, which
 * covers a chat hydrating in front of you (ChatPage loads history *after* mount).
 * What it does not cover is a transcript whose history lands while the surface
 * has NO layout — a tab restored behind `display:none`, or a background pane —
 * because there is nothing to scroll at that moment and the placement is never
 * revisited when the tab is shown. Measured in the chat-scroll story: that case
 * opens ~7200px up, at the very start of the conversation. A wheel/touch/key
 * event during the load has the same effect, dropping the scroller out of its
 * follow-the-bottom mode for good.
 *
 * So the jump is made explicit: try on mount, on hydration, and again whenever
 * the surface gains layout, then stop until the conversation changes so a
 * scrolled-up read is never yanked back down.
 *
 * Rendered above the scroller; scrolls the beUI MessageScroller's viewport,
 * located the same way `usePinnedUserMessage` finds it (by data-slot). Renders
 * nothing.
 */
function OpenAtBottom({
	containerRef,
	enabled,
	hasMessages,
	conversationKey,
}: {
	containerRef: React.RefObject<HTMLDivElement | null>;
	enabled: boolean;
	hasMessages: boolean;
	conversationKey: string | null;
}) {
	const settledKeyRef = useRef<string | null>(null);

	useEffect(() => {
		if (
			!(enabled && hasMessages && conversationKey) ||
			settledKeyRef.current === conversationKey
		) {
			return;
		}
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const viewport = container.querySelector<HTMLElement>(
			'[data-slot="message-scroller-viewport"]'
		);
		if (!viewport) {
			return;
		}
		let observer: ResizeObserver | null = null;
		const jump = () => {
			// Consult the latch on EVERY pass, not just before installing the
			// observer. Without this the observer — installed only when the first
			// attempt found a zero-height container — keeps firing for the life of
			// the effect and yanks a scrolled-up reader back to the bottom on any
			// resize of the chat container.
			if (settledKeyRef.current === conversationKey) {
				observer?.disconnect();
				return;
			}
			// A surface with no layout yet (a tab still hidden behind `display:none`)
			// would scroll a zero-height viewport and settle on nothing, so wait for
			// the ResizeObserver below to report real height.
			if (container.clientHeight === 0) {
				return;
			}
			if (typeof viewport.scrollTo === "function") {
				viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
			} else {
				viewport.scrollTop = viewport.scrollHeight;
			}
			settledKeyRef.current = conversationKey;
			observer?.disconnect();
		};
		jump();
		if (
			settledKeyRef.current === conversationKey ||
			typeof ResizeObserver === "undefined"
		) {
			return;
		}
		observer = new ResizeObserver(jump);
		observer.observe(container);
		return () => observer?.disconnect();
	}, [containerRef, conversationKey, enabled, hasMessages]);

	return null;
}

export const MessageList = memo(function MessageList({
	messages,
	status,
	className,
	showCopyToolbar = true,
	onBranch,
	onAgentUiSubmit,
	onEditMessage,
	onRegenerateMessage,
	onRetryGeneration,
	onFeedback,
	onToggleReaction,
	reactionsByMessage,
	feedback,
	historyNotice,
	messageActions,
	onContributedMessageAction,
	onSelectVersion,
	versions,
	onSpeak,
	onQuote,
	onOpenFile,
	onOpenLink,
	onWorkflowResume,
	previewResolvers,
	mentionItems,
	suppressQuestionTool = false,
	initialScrollBehavior = "bottom",
	enableImagePreview = true,
	assistantAvatar,
	assistantName,
	assistantPlanningAvatars,
	agentMessageContext,
	currentUser,
	slots,
	classNames,
	toolRenderers,
	contextSize,
	conversationKey,
}: MessageListProps) {
	const [activeCopyId, setActiveCopyId] = useState<string | null>(null);
	// Which user message is currently in inline-edit mode (null = none).
	const [editingId, setEditingId] = useState<string | null>(null);
	const [isMounted, setIsMounted] = useState(false);
	// Whether the reader is at the live edge of the transcript — driven by the
	// beUI scroller's `onFollowChange`. `false` is when the scroll-to-end button
	// appears.
	const [following, setFollowing] = useState(true);
	const scrollerRef = useRef<HTMLDivElement>(null);
	// The beUI MessageScroller's scrollable viewport. Forwarded via
	// `viewportRef` so the pinned bar, the floating date header and the TOC can
	// read scroll position without owning the scroller.
	const viewportRef = useRef<HTMLElement | null>(null);
	const {
		density,
		hideToolDetail,
		inferenceStats,
		openAtBottom,
		pinUserMessage,
	} = useChatDisplayPrefs();
	// A narrow surface (island mini-chat, companion popover) renders the same
	// parts, just without the aids that need width: no centring column, tighter
	// padding, no TOC, no pinned user bar.
	const isCompact = density === "compact";

	const { pinnedMessage, registerAnchor, scrollToPinned } =
		usePinnedUserMessage({
			enabled: pinUserMessage && !isCompact,
			messages,
			scrollerRef,
		});

	// Publish the pinned bar's measured height to the scroller root as
	// `--chat-pin-bar-h`, so the floating date chip can sit UNDER the bar instead
	// of in a fixed lane above it.
	//
	// Measured rather than hard-coded because the bar is 1–3 lines of the pinned
	// message, so its height moves with the message. Written straight to the DOM
	// with no React state on purpose: this component's scroll bookkeeping is what
	// produced the React #185 update loop the comments below keep warning about,
	// and a setState driven by a ResizeObserver is exactly the shape of that bug.
	// A CSS variable re-styles the chip without re-rendering anything.
	const pinBarRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const root = scrollerRef.current;
		if (!root) {
			return;
		}
		const bar = pinBarRef.current;
		if (!bar) {
			root.style.setProperty("--chat-pin-bar-h", "0px");
			return;
		}
		const measure = () => {
			root.style.setProperty("--chat-pin-bar-h", `${bar.offsetHeight}px`);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(bar);
		return () => observer.disconnect();
	}, [pinnedMessage?.id, pinUserMessage, isCompact]);

	const CustomUserMessage = slots?.UserMessage || UserMessage;
	const CustomToolRenderer = slots?.ToolRenderer || DefaultToolRenderer;

	const markCopied = useCallback((id: string) => {
		setActiveCopyId(id);
	}, []);

	useEffect(() => {
		setIsMounted(true);
	}, []);

	useEffect(() => {
		const handlePointerDown = () => {
			setActiveCopyId(null);
		};
		window.addEventListener("pointerdown", handlePointerDown);
		return () => window.removeEventListener("pointerdown", handlePointerDown);
	}, []);

	const isStreaming = status === "streaming" || status === "submitted";

	const normalizedMessages = useMemo(
		() => normalizeMessages(messages),
		[messages]
	);
	const planningLabel =
		PLANNING_LABELS[getPlanningActivity(normalizedMessages)];
	// Who is on the turn, drawn in the row's leading slot. Several agents overlap
	// slightly (`-space-x-1`) so three marks still read as one group rather than a
	// row of loose icons; a single agent is unaffected by the negative margin.
	// `undefined` (not an empty node) when there is nothing to draw, so the
	// planning row leads with the shimmer label alone.
	const planningMarks = (
		assistantPlanningAvatars?.length
			? assistantPlanningAvatars
			: [assistantAvatar]
	).filter(Boolean);
	const planningLeading =
		planningMarks.length > 0 ? (
			<span className="flex shrink-0 items-center -space-x-1">
				{planningMarks.map((mark, index) => (
					<span
						className="flex size-4 items-center justify-center"
						// biome-ignore lint/suspicious/noArrayIndexKey: avatars are opaque nodes with no id of their own; the list is a fixed-order snapshot of the active agents
						key={index}
					>
						{mark}
					</span>
				))}
			</span>
		) : undefined;
	const rawTurns = useMemo(
		() => groupMessagesIntoTurns(normalizedMessages),
		[normalizedMessages]
	);
	// Computed BEFORE the detail filter below, and off `rawTurns`, because
	// whether an assistant message exists at all is a fact about the stream, not
	// about how much of it we draw.
	const showPlanning = useMemo(() => {
		const lastMessage = normalizedMessages.at(-1);
		const lastTurn = rawTurns.at(-1);
		return shouldShowPlanning({
			hasMessages: Boolean(lastMessage),
			lastMessageIsUser: lastMessage?.role === "user",
			lastTurnHasAssistant: Boolean(
				lastTurn && lastTurn.assistantMsgs.length > 0
			),
			isStreaming,
			lastAssistantHasContent: getLastAssistantHasContent(
				normalizedMessages,
				hideToolDetail
			),
		});
	}, [hideToolDetail, isStreaming, normalizedMessages, rawTurns]);

	// --- Detail level "None" -----------------------------------------------
	// A turn whose whole content is tool detail renders nothing at None. Left in
	// the list it would still emit a `MessageScrollerItem`: an empty row that
	// occupies a scroll slot and carries a content-visibility placeholder, i.e.
	// a blank gap in the transcript. So the turn is dropped OUTRIGHT rather than
	// replaced with a minimal "n steps hidden" row — such a row is a tool row
	// under another name and would defeat the point of the level. What keeps
	// that safe: failed tool rows are never hidden, `type: "error"` parts are
	// never hidden, and an interrupted turn counts as visible below — the
	// interruption marker is metadata now (`_interrupted`), not a text part, so
	// a turn that died with nothing but hidden tool work would otherwise vanish
	// entirely at None and take its crash notice with it.
	//
	// Filtering HERE (not at render time) is deliberate: `separatorKeyByTurnIndex`
	// keys day separators by turn index, so dropping a turn later would leave a
	// separator pointing at a turn that no longer exists.
	//
	// Two turns are always kept:
	//  • one with a user message — the prompt is the user's own text, and an
	//    assistant reply that was pure tool work simply shows no reply bubble;
	//  • the last one while `showPlanning` is on — it is the row's only home,
	//    and dropping it would strand a running agent with no liveness cue.
	const { turns, assistantHiddenTurns } = useMemo(() => {
		if (!hideToolDetail) {
			return { turns: rawTurns, assistantHiddenTurns: EMPTY_TURN_SET };
		}
		const hidden = new Set<AssistantTurn>();
		for (const turn of rawTurns) {
			const visible = turn.assistantMsgs.some(
				(msg) =>
					hasVisibleContentAtNoDetail(msg.parts ?? []) ||
					isInterruptedMessage(msg)
			);
			if (!visible) {
				hidden.add(turn);
			}
		}
		const kept = rawTurns.filter(
			(turn, index) =>
				Boolean(turn.userMsg) ||
				!hidden.has(turn) ||
				(index === rawTurns.length - 1 && showPlanning)
		);
		return { turns: kept, assistantHiddenTurns: hidden };
	}, [hideToolDetail, rawTurns, showPlanning]);

	// --- day grouping ------------------------------------------------------
	// The display time zone is a GROUPING input here, not just a label input:
	// it decides where midnight falls, so changing Appearance → "Date & time"
	// MOVES a separator rather than just retitling one. Subscribing (rather than
	// letting the formatters read the zone at call time, as most surfaces do) is
	// what makes these memos recompute instead of leaving a stale boundary on
	// screen. `useExhaustiveDependencies` is off repo-wide, so the revision sits
	// in the dep arrays below without a suppression; it is intentional, not a
	// leftover.
	const tzRevision = useTimezoneRevision();
	const dayGroups = useMemo(() => groupTurnsByDay(turns), [turns, tzRevision]);
	const separatorKeys = useMemo(
		() => separatorKeyByTurnIndex(dayGroups),
		[dayGroups]
	);
	const startOfToday = useMemo(() => startOfTodayMs(), [tzRevision]);
	// Anchor id → flat turn index, so the floating header can map the scroller's
	// `currentAnchorId` back onto a group. Only turns with a user message are
	// anchors (`scrollAnchor={Boolean(turn.userMsg)}` below), and their anchor id
	// is that message's id.
	const turnIndexByAnchorId = useMemo(() => {
		const byId = new Map<string, number>();
		for (const [index, turn] of turns.entries()) {
			if (turn.userMsg) {
				byId.set(turn.userMsg.id, index);
			}
		}
		return byId;
	}, [turns]);

	// Anchor ids in DOM order: every turn that opens with a user message. The
	// beUI MessageScroller owns scroll-follow but exposes no anchor API, so the
	// transcript tracks "which turn is at the top" itself — the fact the floating
	// date header and the chat TOC both render from.
	const transcriptAnchorIds = useMemo(
		() =>
			turns
				.map((turn) => turn.userMsg?.id)
				.filter((id): id is string => Boolean(id)),
		[turns]
	);
	const {
		currentAnchorId,
		registerAnchor: registerTranscriptAnchor,
		scrollToMessage,
	} = useTranscriptAnchor({
		anchorIds: transcriptAnchorIds,
		enabled: !isCompact,
		viewportRef,
	});

	// --- messaging-style user runs -----------------------------------------
	// A "run" is consecutive messages from the same speaker: one avatar for the
	// whole run, tight spacing inside it. Only the USER side needs computing.
	// `groupMessagesIntoTurns` opens a new turn on every user message and joins
	// every assistant message to the current one, so `turn.assistantMsgs` IS the
	// assistant run and already draws as ONE `Message` with one avatar and one
	// header. A user run, by the same rule, spans consecutive TURNS — i.e.
	// sibling `MessageScrollerItem`s — which is exactly why it cannot be a
	// wrapper element: `MessageScrollerContent`'s MutationObserver watches
	// `childList` with no `subtree`, so a new turn appended inside a per-run
	// wrapper would fire no mutation and scroll-new-turn-to-top would die
	// silently. The run is therefore carried as `data-group-position` on each
	// item plus a computed avatar flag, never as a container.
	//
	// A run continues past turn i when all of these hold:
	//  • turn i draws no assistant reply — the other party breaks a run;
	//  • a next turn exists AND opens with a user message;
	//  • no day separator falls between them — a new day starts a fresh run,
	//    which is what Telegram/WhatsApp do and what keeps the avatar attached
	//    to the block the separator introduces.
	// `assistantHiddenTurns` is consulted rather than `assistantMsgs.length`
	// because at Detail level "None" a turn of pure tool work draws NOTHING, and
	// an invisible reply must not break a run the reader sees as continuous.
	const userRunPositions = useMemo(() => {
		const continues = turns.map((turn, index) => {
			const nextUserMsg = turns[index + 1]?.userMsg;
			const drawsAssistant =
				turn.assistantMsgs.length > 0 && !assistantHiddenTurns.has(turn);
			return Boolean(
				turn.userMsg &&
					!drawsAssistant &&
					nextUserMsg &&
					widgetMessageProvenanceKey(turn.userMsg) ===
						widgetMessageProvenanceKey(nextUserMsg) &&
					!separatorKeys.has(index + 1)
			);
		});
		return turns.map((_turn, index) => {
			const isLast = !continues[index];
			const isFirst = index === 0 || !continues[index - 1];
			if (isFirst && isLast) {
				return "single" as const;
			}
			if (isFirst) {
				return "first" as const;
			}
			return isLast ? ("last" as const) : ("middle" as const);
		});
	}, [turns, assistantHiddenTurns, separatorKeys]);

	// Built from the FILTERED turns, so a turn None dropped gets no entry. The
	// per-entry `files` list survives None on purpose: the TOC is navigation
	// ("jump to where that file changed"), not a tool row, and stripping it
	// would leave the aid weaker without making the transcript any quieter.
	const tocItems = useMemo<ChatTocItem[]>(() => {
		const items: ChatTocItem[] = [];
		for (const turn of turns) {
			if (!turn.userMsg) {
				continue;
			}
			const text = getTextFromParts(turn.userMsg.parts ?? [], " ").trim();
			if (!text) {
				continue;
			}
			const title = text.length > 80 ? `${text.slice(0, 80)}…` : text;
			const assistantParts = turn.assistantMsgs.flatMap((m) => m.parts ?? []);
			const reply = getTextFromParts(assistantParts, " ").trim();
			const description =
				reply.length > 160 ? `${reply.slice(0, 160)}…` : reply || undefined;
			items.push({
				id: turn.userMsg.id,
				title,
				description,
				agentAvatar: assistantAvatar,
				agentName: assistantName,
				files: getChangedFilesFromParts(assistantParts),
			});
		}
		return items;
	}, [turns, assistantAvatar, assistantName]);

	// The beUI rail's items: one tick per user turn, keyed by that message's id
	// (matched to the row's `data-message-id` for scroll targeting). Each item
	// carries the full TOC entry so the rail's preview card can render our info.
	const railItems = useMemo<PreviewRailItem[]>(
		() =>
			tocItems.map((item) => ({
				id: item.id,
				label: item.title,
				description: item.description,
				ariaLabel: `Go to message: ${item.title}`,
				data: item,
			})),
		[tocItems]
	);

	// Sidebar / deep-link jump: ChatPage and AppSidebar dispatch this once
	// messages hydrate. The beUI rail has no event surface of its own, so the
	// listener lives here next to the scroll target it drives.
	useEffect(() => {
		const onJump = (event: Event) => {
			const messageId = (event as CustomEvent<{ messageId?: string }>).detail
				?.messageId;
			if (messageId) {
				scrollToMessage(messageId);
			}
		};
		window.addEventListener("ryu:scroll-to-message", onJump);
		return () => window.removeEventListener("ryu:scroll-to-message", onJump);
	}, [scrollToMessage]);

	return (
		<div className="relative flex min-h-0 flex-1 flex-col" ref={scrollerRef}>
			{/* A surface that deliberately reads top-down (a static transcript)
			    opts out via `initialScrollBehavior="top"`; the user opts out via
			    Appearance → "Open chats at the latest message". */}
			<OpenAtBottom
				containerRef={scrollerRef}
				conversationKey={conversationKey ?? normalizedMessages[0]?.id ?? null}
				enabled={openAtBottom && initialScrollBehavior !== "top"}
				hasMessages={normalizedMessages.length > 0}
			/>
			{/* beUI MessageScroller: self-contained follow-at-the-live-edge viewport.
			    `data-slot` props below preserve the transcript DOM contract the
			    pinned-message bar and the e2e scroll/grouping/date specs read. The
			    turn rows render as plain `message-scroller-item` children (beUI
			    has no item primitive), with the same `data-group-position` the
			    sender-run styling keys off.
			    `followOutput` is gated by the SAME pref `OpenAtBottom` reads: with
			    "Open chats at the latest message" off, a transcript that hydrated
			    hidden must stay where it loaded once revealed — the beUI scroller's
			    ResizeObserver would otherwise re-follow the reveal resize and yank
			    it to the bottom (chat-scroll-story.spec.ts asserts this). */}
			<BeuiMessageScroller
				busy={isStreaming}
				className={cn("an-message-list flex-1", className)}
				contentClassName={cn(
					"w-full gap-0",
					isCompact ? "px-0.5 py-1" : "mx-auto max-w-[744px] px-3 py-6"
				)}
				contentProps={{ "data-slot": "message-scroller-content" }}
				followOutput={openAtBottom && initialScrollBehavior !== "top"}
				label="Conversation"
				navigation={isCompact ? undefined : "rail"}
				onFollowChange={setFollowing}
				railItems={railItems}
				renderPreview={(item) => <ChatRailPreview item={item} />}
				smooth
				viewportProps={{ "data-slot": "message-scroller-viewport" }}
				viewportRef={viewportRef}
			>
				{pinUserMessage && !isCompact && pinnedMessage ? (
					// `data-slot` is load-bearing: the pin bar sits IN FLOW, so
					// mounting it pushes every anchor below it down by its own
					// height. usePinnedUserMessage measures this element to size the
					// release hysteresis that stops the bar un-electing its own
					// anchor (see PIN_RELEASE_SLACK).
					//
					// `top-0`: the bar owns the TOP lane, and the floating date chip
					// now paints below it (see `pinBarRef` for how the chip learns
					// this bar's height). It used to be the other way round —
					// `top-9`, reserving 36px above for the chip — which put the
					// chip in the topmost band of the transcript, where it collided
					// with the tab bar and read as chrome rather than as part of the
					// conversation.
					//
					// It MUST be a sticky top offset and NOT padding — an offset
					// only moves where the bar paints, whereas padding would change
					// its offsetHeight, which is the very number PINNED_BAR_SLOT /
					// PIN_RELEASE_SLACK measure.
					<div
						className="sticky top-0 z-20 -mb-1"
						data-slot="pinned-user-message-bar"
						ref={pinBarRef}
					>
						<div className="mx-auto w-full max-w-[744px] px-3 pt-2 pb-1">
							<PinnedUserMessageBar
								message={pinnedMessage}
								onScrollTo={scrollToPinned}
							/>
						</div>
					</div>
				) : null}
				{/* 744 = the composer's own 720px column PLUS its `px-3` gutter
				    (input-bar.tsx wraps `mx-auto max-w-[720px]` in `px-3`).
				    Matching both numbers — not just the 720 — is what puts a
				    message's content edges on the composer's card edges at every
				    width. With `max-w-[720px] px-4` the transcript sat 16px inside
				    the composer on each side, which reads as a gap to the right of
				    the user avatar. */}
				{/* `gap-0`, NOT the `gap-2` this used to carry. A uniform gap can
				    only express one vertical rhythm, and messaging grouping needs
				    two: ~2px between consecutive messages from the same speaker
				    and 8px everywhere else. A run spans SIBLING children here (see
				    `userRunPositions`), so the tightening cannot live on a wrapper
				    — every direct child brings its own explicit top margin
				    instead, keyed off `data-group-position`. Negative margins are
				    deliberately not used: they would fight the scroller's
				    intrinsic-size estimates. */}
				{turns.map((turn, turnIndex) => {
					const isLastTurn = turnIndex === turns.length - 1;
					const turnKey = turn.userMsg?.id ?? `turn-${turnIndex}`;
					// Present only on the turn that OPENS a day run, and never
					// for the undated head run (subagent transcripts, the
					// storyboard and the e2e fixtures carry no `createdAt`, so
					// they get no separators at all).
					const separatorKey = separatorKeys.get(turnIndex);
					// Where this turn's USER row sits in its sender run. Also the
					// spacing key: a row that continues a run sits 2px under its
					// predecessor, everything else keeps the 8px the old `gap-2`
					// on Content used to give every child.
					const groupPosition = userRunPositions[turnIndex] ?? "single";
					const continuesRun =
						groupPosition === "middle" || groupPosition === "last";

					return (
						// A Fragment, NOT a wrapper element: the separator and the
						// turn must both be DIRECT children of Content, so the
						// separator can never be picked as a scroll target. beUI
						// has no item primitive, so the turn is a plain div that
						// carries the item data-slot the grouping specs read.
						<Fragment key={turnKey}>
							{separatorKey === undefined ? null : (
								<DateSeparator label={dayLabel(separatorKey, startOfToday)} />
							)}
							<div
								className={cn(
									"relative space-y-2",
									continuesRun ? "mt-0.5" : "mt-2"
								)}
								data-group-position={groupPosition}
								data-message-id={turn.userMsg ? turnKey : undefined}
								data-slot="message-scroller-item"
							>
								{turn.userMsg &&
									(() => {
										const text = getTextFromParts(
											turn.userMsg?.parts ?? [],
											""
										);
										const hasParts = (turn.userMsg?.parts ?? []).length > 0;
										if (!(text || hasParts)) {
											return null;
										}
										const userCopyKey = `user-${turn.userMsg.id}`;
										const userCopyVisible = activeCopyId === userCopyKey;
										// Only render the toolbar when it has content — copy
										// button (gated by showCopyToolbar).
										// Otherwise a 28px-tall empty row inflates the gap to the
										// assistant reply.
										const showUserToolbar = showCopyToolbar && Boolean(text);
										const userMsgId = turn.userMsg.id;
										const userVersion = versions?.[userMsgId];
										const isEditingThis = editingId === userMsgId;
										return (
											<div
												className="group/user-message"
												ref={(el) => {
													// `userMsgId` above is the same id, already narrowed
													// to a definite string; `turn.userMsg?.id` was
													// `string | undefined` and registerAnchor needs one.
													registerAnchor(userMsgId, el);
													registerTranscriptAnchor(userMsgId, el);
												}}
											>
												<CustomUserMessage
													// Handed to UserMessage rather than rendered as a
													// sibling: as a sibling of the whole (full-width)
													// message no justify class can reach the right-aligned
													// bubble's left edge. Inside the bubble's own column it
													// lands on that edge by construction — and still shares
													// a left edge with the assistant toolbar for turns whose
													// bubble spans the column.
													actions={
														!isEditingThis && showUserToolbar ? (
															<MessageToolbar
																alignClass="justify-start"
																heightClass="h-[28px]"
																hoverClass="group-hover/user-message:opacity-100 group-hover/user-message:pointer-events-auto"
																isVisible={userCopyVisible}
																onBranch={
																	onBranch
																		? () => onBranch(userMsgId)
																		: undefined
																}
																onCopied={() => markCopied(userCopyKey)}
																onEdit={
																	onEditMessage && text
																		? () => setEditingId(userMsgId)
																		: undefined
																}
																text={showCopyToolbar ? text : ""}
															/>
														) : null
													}
													className={classNames?.userMessage}
													currentUser={currentUser}
													editing={isEditingThis}
													enableImagePreview={enableImagePreview}
													groupPosition={groupPosition}
													mentionItems={mentionItems}
													message={turn.userMsg}
													onEditCancel={() => setEditingId(null)}
													onEditSubmit={(next: string) => {
														setEditingId(null);
														onEditMessage?.(userMsgId, next);
													}}
													onOpenFile={onOpenFile}
													onOpenLink={onOpenLink}
													onToggleReaction={
														onToggleReaction
															? (emoji: string) =>
																	onToggleReaction(userMsgId, emoji)
															: undefined
													}
													previewResolvers={previewResolvers}
													// A message still carrying its client-generated id
													// cannot take a reaction: Core 404s it by design.
													reactable={isServerAssignedMessageId(userMsgId)}
													reactions={reactionsByMessage?.get(userMsgId)}
												/>
												{!isEditingThis &&
													userVersion &&
													userVersion.count > 1 &&
													onSelectVersion && (
														<VersionPager
															alignClass="justify-end"
															count={userVersion.count}
															ids={userVersion.ids}
															index={userVersion.index}
															onSelect={onSelectVersion}
														/>
													)}
											</div>
										);
									})()}

								{turn.assistantMsgs.length > 0 &&
									// Detail level "None" and this turn was pure tool
									// work: no reply bubble at all. The turn itself
									// survives here only because it carries the user's
									// own message (or the planning row) — see the
									// filter above.
									!assistantHiddenTurns.has(turn) &&
									!(isLastTurn && showPlanning) &&
									(() => {
										const assistantText = getTextFromParts(
											turn.assistantMsgs.flatMap((msg) => msg.parts ?? []),
											"\n\n"
										);
										const isTurnStreaming = isStreaming && isLastTurn;
										// Only reserve toolbar height when there's actually
										// something to show in it. With showCopyToolbar=false the
										// toolbar would otherwise render as a 48px-tall empty box,
										// creating large gaps between assistant turns.
										const hasAssistantText = Boolean(assistantText.trim());
										// The reply's send time comes from the last
										// assistant message (the turn's final part);
										// mirrors the user row.
										const assistantCreatedAt = (
											turn.assistantMsgs.at(-1) as {
												createdAt?: Date | string;
											}
										)?.createdAt;
										const assistantTimestamp =
											isMounted && assistantCreatedAt
												? new Date(assistantCreatedAt)
												: null;
										const showToolbar =
											(showCopyToolbar || Boolean(onSpeak)) &&
											hasAssistantText &&
											!isTurnStreaming;
										const copyKey = `assistant-${turnKey}-all`;
										const toolbarText = showCopyToolbar ? assistantText : "";
										const branchMsgId = turn.assistantMsgs.at(-1)?.id;
										const onBranchTurn =
											onBranch && branchMsgId
												? () => onBranch(branchMsgId)
												: undefined;
										const onSpeakTurn =
											onSpeak && hasAssistantText
												? () => onSpeak(assistantText)
												: undefined;
										const onRegenerateTurn =
											onRegenerateMessage && branchMsgId
												? () => onRegenerateMessage(branchMsgId)
												: undefined;
										const onFeedbackTurn =
											onFeedback && branchMsgId
												? (next: FeedbackRating | null) =>
														onFeedback(branchMsgId, next, isLastTurn)
												: undefined;
										const feedbackRating = branchMsgId
											? feedback?.[branchMsgId]
											: undefined;
										// Contributed per-message actions for this assistant turn,
										// filtered to `assistant`/`any` targets (the shell resolved the
										// feed; blocks stays presentational).
										const assistantActions = messageActions?.filter(
											(a) => a.target === "assistant" || a.target === "any"
										);
										const onContributedActionTurn = onContributedMessageAction
											? (action: ContributedMessageAction, value?: string) =>
													onContributedMessageAction(action, value)
											: undefined;
										const assistantVersion = branchMsgId
											? versions?.[branchMsgId]
											: undefined;
										const turnInterrupted =
											turn.assistantMsgs.some(isInterruptedMessage);

										return (
											<Message align="start" className="group/assistant-turn">
												{assistantAvatar ? (
													<MessageAvatar className="self-start bg-transparent group-has-data-[slot=message-footer]/message:translate-y-0">
														{assistantAvatar}
													</MessageAvatar>
												) : null}
												<MessageContent className="gap-1.5">
													{assistantName ? (
														<MessageHeader className="gap-2 px-0">
															<span>{assistantName}</span>
															{assistantTimestamp && (
																<TooltipProvider delay={0}>
																	<Tooltip>
																		{/* Base UI composes through `render`, not `asChild`. */}
																		<TooltipTrigger
																			render={
																				<span className="inline-flex items-center text-muted-foreground/70 text-xs">
																					{formatTime(
																						assistantTimestamp,
																						MESSAGE_TIME_OPTIONS
																					)}
																				</span>
																			}
																		/>
																		<TooltipContent>
																			<p>
																				{formatDateTime(
																					assistantTimestamp,
																					MESSAGE_TOOLTIP_OPTIONS
																				)}
																			</p>
																		</TooltipContent>
																	</Tooltip>
																</TooltipProvider>
															)}
														</MessageHeader>
													) : null}
													<div className="flex flex-col gap-3">
														{turn.assistantMsgs.map((msg, i) => {
															const isLastMsg =
																isLastTurn &&
																i === turn.assistantMsgs.length - 1;
															return (
																<AssistantParts
																	isLast={isLastMsg}
																	isStreaming={isStreaming}
																	key={msg.id}
																	mentionItems={mentionItems}
																	msg={msg}
																	onAgentUiSubmit={onAgentUiSubmit}
																	onOpenFile={onOpenFile}
																	onOpenLink={onOpenLink}
																	onRetryGeneration={onRetryGeneration}
																	onWorkflowResume={onWorkflowResume}
																	previewResolvers={previewResolvers}
																	suppressQuestionTool={suppressQuestionTool}
																	ToolRendererComponent={CustomToolRenderer}
																	agentMessageContext={agentMessageContext}
																	toolRenderers={toolRenderers}
																/>
															);
														})}
													</div>
													{turnInterrupted ? (
														// The turn the node died in the middle of. Driven by
														// `_interrupted` — server-stamped and reconciled at Core boot —
														// and NOT by sniffing the text, which is how this used to work:
														// the history mapper appended an "⚠️ Interrupted…" sentence as a
														// trailing text part, so a crash notice was indistinguishable
														// from something the agent wrote, came along when you copied the
														// reply, and had to be pattern-matched back out on resume.
														<Marker className="pt-0.5 text-destructive">
															<MarkerIcon>
																<HugeiconsIcon
																	icon={Alert02Icon}
																	strokeWidth={2}
																/>
															</MarkerIcon>
															<MarkerContent>
																Interrupted — this reply was cut off before it
																finished. Send a follow-up to continue; it will
																not auto-resume after a restart.
															</MarkerContent>
														</Marker>
													) : null}
													{(() => {
														// Gate the whole footer, not each component: an
														// empty `MessageFooter` still renders a gapped
														// row under every turn.
														if (!inferenceStats) {
															return null;
														}
														const lastAssistantMsg = turn.assistantMsgs.at(-1);
														return lastAssistantMsg ? (
															<MessageFooter className="gap-3">
																{/* Local-engine (llama.cpp) finalized stats. */}
																<MessageStats
																	contextSize={contextSize}
																	msg={lastAssistantMsg}
																/>
																{/* ACP agents: live-ticking token count while
															    streaming, then frozen count + tok/s +
															    duration once the frame sets done:true.
															    `isLive` is the second brake — a turn that
															    never got its done:true frame (crash, Stop,
															    Core restart) would otherwise tick forever,
															    including days later when the thread is
															    reopened. */}
																<AcpUsageStats
																	isLive={isTurnStreaming}
																	msg={lastAssistantMsg}
																/>
															</MessageFooter>
														) : null;
													})()}
													{showToolbar ? (
														<MessageToolbar
															alignClass="justify-start"
															contributedActions={assistantActions}
															feedbackRating={feedbackRating}
															heightClass="h-6 w-full"
															hoverClass="group-hover/assistant-turn:opacity-100 group-hover/assistant-turn:pointer-events-auto"
															// Latest turn: pin the action buttons open so they
															// don't require a hover; older turns stay hover-only
															// via hoverClass.
															isVisible={isLastTurn || activeCopyId === copyKey}
															onBranch={onBranchTurn}
															onContributedAction={onContributedActionTurn}
															onCopied={() => markCopied(copyKey)}
															onFeedback={onFeedbackTurn}
															onRegenerate={onRegenerateTurn}
															onSpeak={onSpeakTurn}
															text={toolbarText}
														/>
													) : activeCopyId === copyKey ? (
														<MessageToolbar
															alignClass="justify-start"
															contributedActions={assistantActions}
															feedbackRating={feedbackRating}
															heightClass="h-6 w-full"
															hoverClass="group-hover/assistant-turn:opacity-100 group-hover/assistant-turn:pointer-events-auto"
															isVisible={true}
															onBranch={onBranchTurn}
															onContributedAction={onContributedActionTurn}
															onCopied={() => markCopied(copyKey)}
															onFeedback={onFeedbackTurn}
															onRegenerate={onRegenerateTurn}
															onSpeak={onSpeakTurn}
															text={toolbarText}
														/>
													) : null}
													{assistantVersion &&
														assistantVersion.count > 1 &&
														onSelectVersion && (
															<VersionPager
																alignClass="justify-start"
																count={assistantVersion.count}
																ids={assistantVersion.ids}
																index={assistantVersion.index}
																onSelect={onSelectVersion}
															/>
														)}
												</MessageContent>
											</Message>
										);
									})()}

								{isLastTurn && showPlanning && (
									<div className="flex items-center gap-2 py-0.5">
										{planningLeading}
										<ReasoningText
											className="text-sm"
											indicator={null}
											interval={2600}
											phrases={[planningLabel]}
											variant="swap"
										/>
									</div>
								)}
							</div>
						</Fragment>
					);
				})}
				{historyNotice ? (
					// A thread-level notice, not a turn-level one, so it is the LAST
					// direct child of Content rather than part of any message. No
					// `messageId` and no scroll anchor, so it can never become the
					// scroll target and steal the jump from the user's next question —
					// the same rule the date separators follow.
					<Marker className="mt-2 shrink-0 py-1" key={historyNotice.id}>
						<MarkerIcon>
							<HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
						</MarkerIcon>
						<MarkerContent>
							<span className="font-medium">{historyNotice.title}</span>
							{historyNotice.description ? (
								<span> {historyNotice.description}</span>
							) : null}
						</MarkerContent>
						{historyNotice.actions?.map((action) => (
							<button
								className="shrink-0 underline underline-offset-3 hover:text-foreground"
								key={action.label}
								onClick={action.onClick}
								type="button"
							>
								{action.label}
							</button>
						))}
					</Marker>
				) : null}
			</BeuiMessageScroller>
			{/* The scrolled-up escape hatch: beUI keeps following output only while
			    the reader stays at the live edge, so once they scroll up there is no
			    built-in way back down. A compact end button appears in that state
			    and returns to the newest message. `onFollowChange` drives it. */}
			{isCompact || following ? null : (
				<Button
					aria-label="Scroll to end"
					className="absolute inset-x-0 bottom-3 z-30 mx-auto flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/85 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground"
					onClick={() => {
						const viewport = viewportRef.current;
						if (!viewport) {
							return;
						}
						if (typeof viewport.scrollTo === "function") {
							viewport.scrollTo({
								top: viewport.scrollHeight,
								behavior: "smooth",
							});
						} else {
							viewport.scrollTop = viewport.scrollHeight;
						}
					}}
					size="icon"
					type="button"
					variant="ghost"
				>
					{isStreaming ? (
						<Loader
							label="Agent is active"
							size={16}
							speed={0.8}
							variant="dots"
						/>
					) : (
						<HugeiconsIcon icon={ArrowDown02Icon} strokeWidth={2} />
					)}
					<span className="sr-only">Scroll to end</span>
				</Button>
			)}
			{/* FloatingDateHeader is OUT OF FLOW BY CONSTRUCTION — it absolutely
			    positions against this relative root, exactly where it used to sit
			    inside the shadcn scroller's own root. Keeping it out of flow means
			    mounting it can never move a scroll anchor, which is the same
			    guarantee the pinned-user-message bar's design depends on. (The old
			    left-gutter ChatToc is gone — the beUI rail navigation replaced it,
			    with the same info rendered in its preview cards.) */}
			{isCompact ? null : (
				<FloatingDateHeader
					currentAnchorId={currentAnchorId}
					groups={dayGroups}
					startOfToday={startOfToday}
					turnIndexByAnchorId={turnIndexByAnchorId}
				/>
			)}
			{onQuote && (
				<SelectionQuoteToolbar containerRef={scrollerRef} onQuote={onQuote} />
			)}
		</div>
	);
});

/**
 * Stable stand-in for "no custom renderers". `toolRenderers` is a dependency of
 * the memo that builds a message's whole element tree, so a caller passing a
 * fresh `{}` (or leaving it undefined and letting a literal default be created
 * per render) rebuilds that tree every render.
 */
const NO_TOOL_RENDERERS: Record<
	string,
	React.ComponentType<CustomToolRendererProps>
> = Object.freeze({});

function AssistantParts({
	msg,
	isLast,
	isStreaming,
	suppressQuestionTool,
	ToolRendererComponent,
	toolRenderers = NO_TOOL_RENDERERS,
	onOpenFile,
	onOpenLink,
	mentionItems,
	previewResolvers,
	onRetryGeneration,
	onWorkflowResume,
	onAgentUiSubmit,
	agentMessageContext,
}: {
	agentMessageContext?: AgentMessageContext;
	msg: UIMessage;
	isLast: boolean;
	isStreaming: boolean;
	suppressQuestionTool: boolean;
	ToolRendererComponent: React.ComponentType<ToolRendererProps>;
	toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>;
	onOpenFile?: (path: string) => void;
	onOpenLink?: (url: string) => void;
	mentionItems?: MentionItem[];
	previewResolvers?: LinkPreviewResolvers;
	onRetryGeneration?: MessageListProps["onRetryGeneration"];
	onWorkflowResume?: MessageListProps["onWorkflowResume"];
	onAgentUiSubmit?: MessageListProps["onAgentUiSubmit"];
}) {
	const { expandCommands, expandFileEdits, groupToolUses, hideToolDetail } =
		useChatDisplayPrefs();
	const parts = useMemo(
		() => normalizeAssistantToolParts(msg.parts ?? []) as unknown[],
		[msg.parts]
	);

	const { elements } = useMemo(() => {
		// Each part is tagged as prose or not, because only the PROSE runs get a
		// bubble (see the fold at the end of this memo). Tool rows, generated
		// media, error cards and widgets already draw their own `bg-card`
		// surfaces; boxing them a second time double-frames every one of them.
		const elems: { isText: boolean; node: React.ReactNode }[] = [];
		const pushPart = (node: React.ReactNode, isText = false) => {
			elems.push({ isText, node });
		};
		// Extract once so text parts can render inline `[n]` chips against the
		// same numbered list shown in the sources footer. Read from the FULL part
		// list, before any detail filtering: the chips are numbered against this
		// list, so extracting from a filtered one would point `[2]` at a source
		// that is no longer there. Citations survive Detail level "None" — they
		// are part of the reply, not a tool row.
		const citations = extractCitations(parts);
		const taskPartIds = new Set(
			parts
				.filter(
					(p): p is ToolPartBase =>
						isV5ToolPart(p) &&
						(p.type === "tool-Task" || p.type === "tool-Agent") &&
						typeof p.toolCallId === "string"
				)
				.map((p) => p.toolCallId!)
		);
		const nestedToolsMap = new Map<string, ToolPartBase[]>();
		const nestedToolIds = new Set<string>();
		// Reactive-failover verdicts, collected up front so the PLAIN-TEXT TWIN
		// of each one can be dropped below. Core deliberately emits both: the
		// structured `data-ryu-failover` part for anything that can read data
		// frames, and the same `note` as an ordinary text block because
		// `/api/chat/stream` is not desktop-only — the TUI, the native app and the
		// island all POST to it and none of them renders `data-*`. So the twin
		// stays on the wire (removing it would silently strip the explanation from
		// those surfaces); it is suppressed HERE, where the structured part is
		// about to be drawn as a Marker instead.
		const failoverNotes = new Set<string>();
		for (const part of parts) {
			const note = getFailoverNote(part);
			if (note) {
				failoverNotes.add(note);
			}
		}

		// Only collect nested tools into the parent group when grouping is on.
		// When off, every tool renders individually (nestedToolIds stays empty so
		// the skip-check at render time doesn't hide them).
		//
		// Detail level "None" also switches grouping off, and not as a shortcut:
		// the only tool rows that survive None are the FAILED ones, and rolling a
		// failed child into a hidden parent would swallow the failure entirely.
		// With grouping off, every failed call is judged on its own.
		if (groupToolUses && !hideToolDetail) {
			for (const part of parts) {
				if (!isV5ToolPart(part)) {
					continue;
				}
				if (part.type === "tool-TaskOutput") {
					continue;
				}
				if (!part.toolCallId?.includes(":")) {
					continue;
				}
				const parentId = part.toolCallId.split(":")[0];
				if (!taskPartIds.has(parentId)) {
					continue;
				}
				if (!nestedToolsMap.has(parentId)) {
					nestedToolsMap.set(parentId, []);
				}
				nestedToolsMap.get(parentId)?.push(part);
				nestedToolIds.add(part.toolCallId);
			}
		}

		let i = 0;
		while (i < parts.length) {
			const part = parts[i]!;

			if (isV5ToolPart(part) && part.type === "tool-TaskOutput") {
				i++;
				continue;
			}

			// The structured failover verdict, drawn as a Marker between the
			// reply's prose. `stand` never reaches a client, so any verdict that
			// arrives has something to say.
			const failoverNote = getFailoverNote(part);
			if (failoverNote) {
				pushPart(
					<Marker className="py-1" key={`${msg.id}-failover-${i}`}>
						<MarkerIcon>
							<HugeiconsIcon
								icon={ArrowDataTransferHorizontalIcon}
								strokeWidth={2}
							/>
						</MarkerIcon>
						<MarkerContent>{failoverNote}</MarkerContent>
					</Marker>
				);
				i++;
				continue;
			}

			// A workflow run part — the live per-node checklist Core streams while
			// a `workflow_id` chat turn executes. Repeated frames reconcile into
			// one part, so this renders once per turn, updating in place.
			if (isWorkflowRunPart(part)) {
				pushPart(
					<WorkflowRunProgressCard
						key={`${msg.id}-workflow-${i}`}
						msg={msg}
						onResume={onWorkflowResume}
					/>
				);
				i++;
				continue;
			}

			if (isTextPart(part)) {
				const text = part.text;
				// The plain-text twin of a verdict we just drew as a Marker. Dropped
				// here rather than server-side; see `failoverNotes` above.
				if (failoverNotes.has(text.trim())) {
					i++;
					continue;
				}
				if (text) {
					pushPart(
						// A `BubbleContent`, folded into a `Bubble` with its neighbouring
						// prose parts below. `w-fit` on the primitive is what makes a
						// one-line reply a small pill and a long one fill the column.
						<BubbleContent
							className="group/assistant-text text-[14px]"
							key={`${msg.id}-text-${i}`}
							{...messageSelectableProps}
						>
							<Markdown
								citations={citations.length > 0 ? citations : undefined}
								className="leading-relaxed [&_p]:leading-relaxed"
								content={text}
								mentionItems={mentionItems}
								onOpenFile={onOpenFile}
								onOpenLink={onOpenLink}
								previewResolvers={previewResolvers}
							/>
						</BubbleContent>,
						true
					);
				}
				i++;
				continue;
			}

			const generation = getImageGenerationPart(part);
			if (generation) {
				// Retry re-runs the SAME prompt against the same message, so it needs
				// one: a generation part that never carried a prompt (older shape, or
				// a producer that failed before it had one) gets no dead button.
				const retryPrompt = generation.prompt;
				pushPart(
					<AssistantGeneratedImage
						key={`${msg.id}-image-generation-${i}`}
						onRetry={
							onRetryGeneration && retryPrompt
								? () => onRetryGeneration(msg.id, "image", retryPrompt)
								: undefined
						}
						prompt={generation.prompt}
						showStatus
						status={generation.status}
						statusText={generation.statusText}
						url={generation.url}
					/>
				);
				i++;
				continue;
			}

			const videoGeneration = getVideoGenerationPart(part);
			if (videoGeneration) {
				const retryPrompt = videoGeneration.prompt;
				pushPart(
					<AssistantGeneratedVideo
						key={`${msg.id}-video-generation-${i}`}
						onRetry={
							onRetryGeneration && retryPrompt
								? () => onRetryGeneration(msg.id, "video", retryPrompt)
								: undefined
						}
						poster={videoGeneration.poster}
						prompt={videoGeneration.prompt}
						showStatus
						status={videoGeneration.status}
						statusText={videoGeneration.statusText}
						url={videoGeneration.url}
					/>
				);
				i++;
				continue;
			}

			const imageUrl = getAssistantImageUrl(part);
			if (imageUrl) {
				pushPart(
					<AssistantGeneratedImage
						key={`${msg.id}-image-${i}`}
						showStatus={false}
						status="complete"
						url={imageUrl}
					/>
				);
				i++;
				continue;
			}

			const videoUrl = getAssistantVideoUrl(part);
			if (videoUrl) {
				pushPart(
					<AssistantGeneratedVideo
						key={`${msg.id}-video-${i}`}
						showStatus={false}
						status="complete"
						url={videoUrl}
					/>
				);
				i++;
				continue;
			}

			const fileMeta = getAssistantFileMeta(part);
			if (fileMeta) {
				pushPart(
					fileMeta.media.startsWith("audio/") ? (
						// biome-ignore lint/a11y/useMediaCaption: generated audio has no caption track
						<audio
							className="max-w-[360px]"
							controls
							key={`${msg.id}-audio-${i}`}
							src={fileMeta.url}
						>
							<a href={fileMeta.url}>Download audio</a>
						</audio>
					) : (
						<a
							className="inline-flex max-w-[360px] items-center gap-2 rounded-xl bg-foreground/4 px-3 py-2 text-sm hover:bg-foreground/8"
							download
							href={fileMeta.url}
							key={`${msg.id}-file-${i}`}
							rel="noopener"
						>
							Download attachment ({fileMeta.media})
						</a>
					)
				);
				i++;
				continue;
			}

			if (isErrorPart(part)) {
				pushPart(
					<ErrorMessage
						key={`${msg.id}-error-${i}`}
						message={part.message}
						title={part.title}
					/>
				);
				i++;
				continue;
			}

			if (isV5ToolPart(part)) {
				if (suppressQuestionTool && part.type === "tool-Question") {
					i++;
					continue;
				}
				if (part.toolCallId && nestedToolIds.has(part.toolCallId)) {
					i++;
					continue;
				}
				// Detail level "None": no tool rows, no file edits, no thinking
				// traces — only the calls that FAILED, because a turn that died
				// silently is worse than a turn that shows one row.
				if (hideToolDetail && isHiddenAtNoDetail(part)) {
					i++;
					continue;
				}

				const chatStreamingStatus =
					isLast && isStreaming ? "streaming" : undefined;
				const groupOptions = { expandCommands, expandFileEdits };
				if (
					groupToolUses &&
					ToolRendererComponent === DefaultToolRenderer &&
					isToolActivityGroupCandidate(part, groupOptions)
				) {
					const groupedParts: ToolPartBase[] = [part];
					let nextIndex = i + 1;
					while (nextIndex < parts.length) {
						const nextPart = parts[nextIndex];
						if (
							!isV5ToolPart(nextPart) ||
							(nextPart.toolCallId !== undefined &&
								nestedToolIds.has(nextPart.toolCallId)) ||
							!isToolActivityGroupCandidate(nextPart, groupOptions)
						) {
							break;
						}
						groupedParts.push(nextPart);
						nextIndex += 1;
					}

					if (groupedParts.length > 1) {
						pushPart(
							<ToolGroup
								chatStatus={chatStreamingStatus}
								key={`${msg.id}-tool-group-${i}`}
								parts={groupedParts}
							/>
						);
						i = nextIndex;
						continue;
					}
				}
				const toolCallId = part.toolCallId;
				const nestedTools =
					(part.type === "tool-Task" || part.type === "tool-Agent") &&
					toolCallId
						? nestedToolsMap.get(toolCallId) || []
						: undefined;
				pushPart(
					<ToolRendererComponent
						agentMessageContext={agentMessageContext}
						chatStatus={chatStreamingStatus}
						key={part.toolCallId ?? `${msg.id}-tool-${i}`}
						nestedTools={nestedTools}
						onAgentUiSubmit={onAgentUiSubmit}
						part={part}
						toolRenderers={toolRenderers}
					/>
				);
				i++;
				continue;
			}

			// Route an app-widget data part (D6) through the tool renderer, keyed by
			// its shared `toolCallId` so it attaches after the matching tool row. The
			// default renderer dispatches it to the injected WidgetHostContext.
			if (isWidgetAvailablePart(part)) {
				// A widget exists only because a tool ran, so it is tool detail too.
				if (hideToolDetail) {
					i++;
					continue;
				}
				const widgetToolCallId = part.data?.toolCallId;
				const chatStreamingStatus =
					isLast && isStreaming ? "streaming" : undefined;
				pushPart(
					<ToolRendererComponent
						agentMessageContext={agentMessageContext}
						chatStatus={chatStreamingStatus}
						key={
							widgetToolCallId
								? `${widgetToolCallId}-widget`
								: `${msg.id}-widget-${i}`
						}
						onAgentUiSubmit={onAgentUiSubmit}
						part={part as ToolPartBase}
						toolRenderers={toolRenderers}
					/>
				);
				i++;
				continue;
			}

			i++;
		}

		// Cited sources from this turn's web tools (WebFetch/WebSearch) render as
		// a beUI citation list footer under the reply. Empty when no web tools ran.
		if (citations.length > 0) {
			const citationItems: CitationItem[] = citations.map((citation) => ({
				id: citation.url,
				title: citation.title,
				domain: hostnameOfCitation(citation.url),
				url: citation.url,
			}));
			pushPart(
				<CitationList
					citations={citationItems}
					className="mt-2 rounded-xl bg-muted/60 p-2"
					key={`${msg.id}-citations`}
				/>
			);
		}

		// Fold contiguous prose into ONE `Bubble` per run. A reply that reads
		// "sentence · tool call · sentence" therefore gets two bubbles with the
		// tool row between them, which is what actually happened, rather than one
		// bubble swallowing the tool row or three unrelated boxes.
		//
		// `muted` — a FILL, not a hairline. The two sides now read as one system:
		// the agent takes the neutral filled surface the user side used to own, and
		// the user side moves up to the theme's primary (see `user-message.tsx`). An
		// outline around the agent's prose was the odd one out — the only bubble in
		// the transcript drawn as a border rather than a surface.
		// `max-w-full` overrides the primitive's `max-w-[80%]`, which would squeeze
		// code, tables and diffs.
		const folded: React.ReactNode[] = [];
		let run: React.ReactNode[] = [];
		const flushRun = () => {
			if (run.length === 0) {
				return;
			}
			folded.push(
				<Bubble
					align="start"
					className="max-w-full"
					key={`${msg.id}-bubble-${folded.length}`}
					variant="muted"
				>
					{run}
				</Bubble>
			);
			run = [];
		};
		for (const entry of elems) {
			if (entry.isText) {
				run.push(entry.node);
				continue;
			}
			flushRun();
			folded.push(entry.node);
		}
		flushRun();

		return { elements: folded };
	}, [
		parts,
		msg.id,
		isLast,
		isStreaming,
		suppressQuestionTool,
		groupToolUses,
		hideToolDetail,
		expandCommands,
		expandFileEdits,
		ToolRendererComponent,
		agentMessageContext,
		toolRenderers,
		onRetryGeneration,
		onOpenFile,
		onOpenLink,
		onWorkflowResume,
		previewResolvers,
		mentionItems,
	]);

	// Nothing to draw for this message — return null, not an empty div. Inside
	// the turn's `flex flex-col gap-3` an empty element is not invisible: it
	// still takes a 12px gap from each neighbour. That shows up at Detail level
	// "None" (a turn of prose followed by a message of pure tool calls) and,
	// before it, for a message that held only `tool-TaskOutput` parts.
	if (elements.length === 0) {
		return null;
	}

	if (elements.length > 1) {
		return (
			<div className="group/assistant-turn flex flex-col gap-3">{elements}</div>
		);
	}

	return <div className="group/assistant-turn">{elements}</div>;
}
