"use client";

import { Button } from "@ryu/ui/components/button";
import { Skeleton } from "@ryu/ui/components/skeleton.tsx";
import { cn } from "@ryu/ui/lib/utils";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { deriveContextUsage } from "./context-usage.tsx";
import { type SuggestionItem, Suggestions } from "./input/suggestions.tsx";
import { InputBar } from "./input-bar.tsx";
import { MessageList } from "./message-list.tsx";
import { ComposerQuotePreview } from "./quote.tsx";
import type { AgentChatProps } from "./types.ts";

export function AgentChat({
	messages,
	onSend,
	status,
	onStop,
	error,
	classNames,
	slots,
	toolRenderers,
	attachments,
	showCopyToolbar,
	onBranch,
	onEditMessage,
	onRegenerateMessage,
	onFeedback,
	feedback,
	messageActions,
	onContributedMessageAction,
	onSelectVersion,
	versions,
	onSpeak,
	onQuote,
	onOpenFile,
	quote,
	onClearQuote,
	initialScrollBehavior,
	enableImagePreview,
	assistantAvatar,
	assistantName,
	assistantPlanningAvatars,
	currentUser,
	seedDraft,
	onDraftChange,
	suggestions,
	followUps,
	emptyStatePosition = "default",
	emptySuggestionsPlacement = "input",
	emptySuggestionsPosition = "top",
	emptyStateHeader,
	emptyStateFooter,
	historyLoading,
	historyError,
	questionTool,
	historyNotice,
	className,
	style,
	contextSize,
	conversationKey,
	onOpenContext,
}: AgentChatProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const [draft, setDraft] = useState("");

	// Apply a composer seed (e.g. from a deep link) once per distinct value, so a
	// pre-filled prompt lands in the textarea without clobbering later edits.
	const seededValueRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (seedDraft && seedDraft !== seededValueRef.current) {
			seededValueRef.current = seedDraft;
			setDraft(seedDraft);
		}
	}, [seedDraft]);

	// Observe the composer text for surfaces that persist it (the desktop keeps
	// unsent text as a draft). A ref for the callback so a consumer passing an
	// inline arrow does not re-fire this on every render — the DRAFT changing is
	// the event, not the identity of the listener.
	const draftListener = useRef(onDraftChange);
	draftListener.current = onDraftChange;
	useEffect(() => {
		draftListener.current?.(draft);
	}, [draft]);

	const ResolvedInputBar = slots?.InputBar ?? InputBar;

	// Context-window meter for the composer: the fullness of THIS conversation,
	// derived from the latest turn's usage stats. The denominator prefers an
	// ACP-reported window, else the model's `contextSize` (launch config /
	// models.dev). Null (no meter) until a turn reports usage — it is live-only.
	const contextMeter = useMemo(
		() => deriveContextUsage(messages, contextSize) ?? undefined,
		[messages, contextSize]
	);

	// A failed request is shown as a synthetic trailing assistant message. Built
	// in a memo rather than inline in the JSX because a fresh array literal there
	// hands MessageList a new `messages` identity on EVERY render for as long as
	// an error is on screen — which invalidates normalizeMessages /
	// groupMessagesIntoTurns / the TOC continuously, and re-arms the pinned-message
	// measuring effect every pass (the escalation path to React error #185).
	const listMessages = useMemo(
		() =>
			error
				? [
						...messages,
						{
							id: "agent-chat-error",
							role: "assistant",
							parts: [
								{
									type: "error",
									title: "Request failed",
									message: error.message,
								},
							],
						} as unknown as (typeof messages)[number],
					]
				: messages,
		[error, messages]
	);

	// "Nothing in this thread" and "this thread has not arrived yet" are different
	// facts, and only the first one may show the new-chat greeting. A restored tab
	// paints before its history resolves, so deriving emptiness from the message
	// count ALONE is what made every reopened conversation look like a brand-new
	// chat at boot — the alarming "all my chats are gone" screen. `historyLoading`
	// and `historyError` are only ever set for a thread that HAS a conversation
	// id, so a real new chat still gets its greeting.
	const isPlaceholder = Boolean(historyLoading || historyError);
	const isEmpty = !(error || isPlaceholder) && messages.length === 0;
	const isCenteredEmptyState = isEmpty && emptyStatePosition === "center";
	// The placeholder replaces the transcript only while there is nothing to show;
	// a re-fetch over an already-rendered thread must not blank it.
	const showPlaceholder = isPlaceholder && !error && messages.length === 0;

	const pendingQuestion = findPendingQuestion(messages, questionTool);
	const suggestionConfig = resolveSuggestions(suggestions);
	const showInputSuggestions =
		emptySuggestionsPlacement === "input" ||
		emptySuggestionsPlacement === "both";
	const showEmptySuggestions =
		isCenteredEmptyState &&
		(emptySuggestionsPlacement === "empty" ||
			emptySuggestionsPlacement === "both") &&
		suggestionConfig.items.length > 0;

	const handleEmptySuggestionSelect = (item: SuggestionItem) => {
		setDraft(item.value ?? item.label);
	};

	const emptySuggestionsNode = showEmptySuggestions ? (
		<Suggestions
			className={cn(
				"w-full justify-center",
				emptySuggestionsPosition === "top" ? "mb-3" : "mt-3",
				suggestionConfig.className
			)}
			disabled={status === "streaming" || status === "submitted"}
			itemClassName={cn("h-8 rounded-md px-3", suggestionConfig.itemClassName)}
			items={suggestionConfig.items}
			onSelect={handleEmptySuggestionSelect}
		/>
	) : null;

	// ChatGPT-style follow-up chips: shown between the transcript and the
	// composer once a turn settles (never while streaming, never in the empty
	// state). Selecting one runs it immediately — this is the "one click to do
	// the next task" affordance, distinct from empty-state chips that only seed
	// the draft.
	const followUpItems = followUps?.items ?? [];
	const showFollowUps =
		!(isCenteredEmptyState || error) &&
		followUpItems.length > 0 &&
		status !== "streaming" &&
		status !== "submitted";
	const followUpsNode =
		showFollowUps && followUps ? (
			<div className="shrink-0 px-3 pb-1">
				<Suggestions
					itemClassName="h-8 rounded-full px-3"
					items={followUpItems}
					onSelect={followUps.onSelect}
				/>
			</div>
		) : null;

	const inputBarNode = (
		<ResolvedInputBar
			attachedFiles={attachments?.files}
			attachedImages={attachments?.images}
			className={cn(classNames?.inputBar, isCenteredEmptyState && "px-0 pb-0")}
			composerHeader={
				quote ? (
					<ComposerQuotePreview onDismiss={onClearQuote} text={quote} />
				) : undefined
			}
			contextMeter={contextMeter}
			contextMeterOnOpen={onOpenContext}
			isDragOver={attachments?.isDragOver}
			onAttach={attachments?.onAttach}
			onChange={setDraft}
			onPaste={attachments?.onPaste}
			onRemoveFile={attachments?.onRemoveFile}
			onRemoveImage={attachments?.onRemoveImage}
			onSend={onSend}
			onStop={onStop}
			placeholder={isEmpty ? "Send a message" : "Ask a follow up"}
			questionBar={
				pendingQuestion
					? {
							id: pendingQuestion.id,
							questions: pendingQuestion.questions,
							questionIndex: pendingQuestion.questionIndex,
							totalQuestions: pendingQuestion.totalQuestions,
							onPreviousQuestion: pendingQuestion.onPreviousQuestion,
							onNextQuestion: pendingQuestion.onNextQuestion,
							submitLabel: pendingQuestion.submitLabel,
							skipLabel: pendingQuestion.skipLabel,
							allowSkip: pendingQuestion.allowSkip,
							onSubmit: (answer) => {
								questionTool?.onAnswer?.({
									toolCallId: pendingQuestion.toolCallId,
									question:
										pendingQuestion.questions[
											pendingQuestion.questionIndex
												? pendingQuestion.questionIndex - 1
												: 0
										],
									answer,
								});
							},
						}
					: undefined
			}
			status={status}
			suggestions={showInputSuggestions ? suggestions : []}
			value={draft}
		/>
	);

	let transcriptNode: ReactNode;
	if (isCenteredEmptyState) {
		transcriptNode = (
			<div className="flex min-h-0 flex-1 items-center justify-center px-4 py-4">
				<div className="w-full max-w-[720px]">
					{emptyStateHeader}
					{emptySuggestionsPosition === "top" ? emptySuggestionsNode : null}
					{inputBarNode}
					{emptySuggestionsPosition === "bottom" ? emptySuggestionsNode : null}
					{emptyStateFooter}
				</div>
			</div>
		);
	} else if (showPlaceholder) {
		transcriptNode = (
			<HistoryPlaceholder
				className={classNames?.messageList}
				error={historyError}
			/>
		);
	} else {
		transcriptNode = (
			<MessageList
				assistantAvatar={assistantAvatar}
				assistantName={assistantName}
				assistantPlanningAvatars={assistantPlanningAvatars}
				className={classNames?.messageList}
				classNames={classNames}
				contextSize={contextSize}
				conversationKey={conversationKey}
				currentUser={currentUser}
				enableImagePreview={enableImagePreview}
				feedback={feedback}
				// Declared and destructured since the prop was introduced, but never
				// actually handed to the transcript — so a surface that set it got
				// nothing on screen. It renders as a `Marker` after the last message
				// (see MessageListProps.historyNotice).
				historyNotice={historyNotice}
				initialScrollBehavior={initialScrollBehavior}
				messageActions={messageActions}
				messages={listMessages}
				onBranch={onBranch}
				onContributedMessageAction={onContributedMessageAction}
				onEditMessage={onEditMessage}
				onFeedback={onFeedback}
				onOpenFile={onOpenFile}
				onQuote={onQuote}
				onRegenerateMessage={onRegenerateMessage}
				onSelectVersion={onSelectVersion}
				onSpeak={onSpeak}
				showCopyToolbar={showCopyToolbar}
				slots={slots}
				status={status}
				suppressQuestionTool={Boolean(pendingQuestion)}
				toolRenderers={toolRenderers}
				versions={versions}
			/>
		);
	}

	return (
		<div
			className={cn(
				"flex h-full min-h-0 flex-col",
				classNames?.root,
				className
			)}
			ref={rootRef}
			style={style}
		>
			{transcriptNode}
			{isCenteredEmptyState ? null : (
				<>
					{followUpsNode}
					{inputBarNode}
				</>
			)}
		</div>
	);
}

/**
 * What the transcript area shows while a restored thread's history is still in
 * flight, or when it could not be fetched at all. Deliberately transcript-shaped
 * rather than a spinner: the point is that this tab is a CONVERSATION that has
 * not arrived, not an empty one. The composer stays mounted below it (rendered by
 * the caller), so the tab never reads as dead.
 */
function HistoryPlaceholder({
	className,
	error,
}: {
	className?: string;
	error?: {
		description?: string;
		onRetry?: () => void;
		title: string;
	};
}) {
	if (error) {
		return (
			<div
				className={cn(
					"flex min-h-0 flex-1 items-center justify-center px-4 py-4",
					className
				)}
			>
				<div className="max-w-[420px] text-center">
					<p className="font-medium text-sm">{error.title}</p>
					{error.description ? (
						<p className="mt-1 text-muted-foreground text-sm">
							{error.description}
						</p>
					) : null}
					{error.onRetry ? (
						<Button
							className="mt-3"
							onClick={error.onRetry}
							size="sm"
							variant="outline"
						>
							Try again
						</Button>
					) : null}
				</div>
			</div>
		);
	}
	return (
		<output
			aria-busy="true"
			aria-label="Loading conversation"
			className={cn(
				"flex min-h-0 flex-1 flex-col gap-6 overflow-hidden px-4 py-6",
				className
			)}
		>
			<div className="flex justify-end">
				<Skeleton className="h-9 w-[45%] rounded-2xl" />
			</div>
			<div className="flex gap-3">
				<Skeleton className="h-7 w-7 shrink-0 rounded-full" />
				<div className="flex w-full flex-col gap-2">
					<Skeleton className="h-4 w-[85%] rounded-md" />
					<Skeleton className="h-4 w-[70%] rounded-md" />
					<Skeleton className="h-4 w-[45%] rounded-md" />
				</div>
			</div>
			<div className="flex justify-end">
				<Skeleton className="h-9 w-[30%] rounded-2xl" />
			</div>
		</output>
	);
}

function resolveSuggestions(suggestions: AgentChatProps["suggestions"]) {
	if (Array.isArray(suggestions)) {
		return {
			items: suggestions,
			className: undefined,
			itemClassName: undefined,
		};
	}
	return {
		items: suggestions?.items ?? [],
		className: suggestions?.className,
		itemClassName: suggestions?.itemClassName,
	};
}

function findPendingQuestion(
	messages: AgentChatProps["messages"],
	questionTool: AgentChatProps["questionTool"]
) {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message?.role !== "assistant") {
			continue;
		}
		const parts = message.parts ?? [];
		for (let p = parts.length - 1; p >= 0; p -= 1) {
			const part = parts[p] as {
				type?: string;
				toolCallId?: string;
				input?: {
					questions?: import("./question/question-prompt").QuestionConfig[];
					question?: import("./question/question-prompt").QuestionConfig;
					questionIndex?: number;
					totalQuestions?: number;
					onPreviousQuestion?: () => void;
					onNextQuestion?: () => void;
					submitLabel?: string;
					skipLabel?: string;
					allowSkip?: boolean;
				};
				output?: {
					answer?: import("./question/question-prompt").QuestionAnswer;
				};
			};
			if (part?.type !== "tool-Question") {
				continue;
			}
			const input = part.input;
			const questions = input?.questions ?? [];
			const firstQuestion = questions[0] ?? input?.question;
			if (!firstQuestion) {
				continue;
			}
			if (part.output?.answer) {
				return null;
			}
			return {
				id: part.toolCallId ?? `question-${i}-${p}`,
				toolCallId: part.toolCallId,
				questions,
				question: firstQuestion,
				questionIndex: input?.questionIndex,
				totalQuestions:
					input?.totalQuestions ??
					(questions.length > 0 ? questions.length : undefined),
				onPreviousQuestion: input?.onPreviousQuestion,
				onNextQuestion: input?.onNextQuestion,
				submitLabel: questionTool?.submitLabel ?? input?.submitLabel,
				skipLabel: questionTool?.skipLabel ?? input?.skipLabel,
				allowSkip: questionTool?.allowSkip ?? input?.allowSkip,
			};
		}
	}
	return null;
}

// Legacy component alias kept for compatibility.
export const AnAgentChat = AgentChat;
