// apps/desktop/src/hooks/useMessageReactions.ts
//
// Emoji reactions for one conversation's messages: a single bulk read, an
// optimistic toggle, and a realtime applier for other people's reactions.
//
// One query per CONVERSATION, not per message — a long thread would otherwise
// open hundreds of requests to render a chip row that is empty on most rows.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	addReaction,
	listReactions,
	type ReactionBucket,
	removeReaction,
} from "@/src/lib/api/reactions.ts";
import { useActiveNode } from "./useActiveNode.ts";

/** The realtime frame Core fans out on every reaction write. */
export interface ReactionFrame {
	emoji?: string;
	message_id?: string;
	op?: string;
	type?: string;
	user_id?: string;
}

export interface UseMessageReactionsResult {
	/** Fold a `conversation.reaction` realtime frame into the cache. */
	applyRealtimeFrame: (data: unknown, myUserId: string | null) => void;
	/** Buckets grouped by message id, preserving Core's ordering within a message. */
	byMessage: ReadonlyMap<string, ReactionBucket[]>;
	/** Add or remove the caller's `emoji` on a message, optimistically. */
	toggle: (messageId: string, emoji: string) => void;
}

/**
 * Apply one add/remove to a bucket list, returning a NEW list.
 *
 * Exported for tests: this is the whole reducer, and every path through it
 * (first reaction, join, leave, last-one-out) is easier to pin here than
 * through the query cache.
 *
 * `mine` says whether the change belongs to the calling user, which is the only
 * thing that moves `reactedByMe`. A remote user joining a bucket the caller is
 * already in must bump the count and leave `reactedByMe` alone.
 */
export function applyReactionDelta(
	buckets: readonly ReactionBucket[],
	messageId: string,
	emoji: string,
	op: "add" | "remove",
	mine: boolean
): ReactionBucket[] {
	const index = buckets.findIndex(
		(b) => b.messageId === messageId && b.emoji === emoji
	);
	if (index === -1) {
		// Removing from a bucket that isn't there is a no-op, not an empty bucket:
		// a zero-count chip would render as a ghost nobody can clear.
		if (op === "remove") {
			return buckets as ReactionBucket[];
		}
		// Appended, never inserted — Core orders by FIRST-reaction time, so a new
		// emoji belongs at the end. Sorting here would reshuffle the row under the
		// reader's cursor.
		return [...buckets, { messageId, emoji, count: 1, reactedByMe: mine }];
	}
	const current = buckets[index];
	const delta = op === "add" ? 1 : -1;
	// A duplicate add from the same user (double click, or a frame delivered
	// twice) must not double-count: the set is keyed (message, user, emoji) in
	// Core, so the caller's own state is idempotent.
	if (mine && current.reactedByMe === (op === "add")) {
		return buckets as ReactionBucket[];
	}
	const count = current.count + delta;
	const next = [...buckets];
	if (count <= 0) {
		next.splice(index, 1);
		return next;
	}
	next[index] = {
		...current,
		count,
		reactedByMe: mine ? op === "add" : current.reactedByMe,
	};
	return next;
}

export function useMessageReactions(
	conversationId: string | null
): UseMessageReactionsResult {
	const node = useActiveNode();
	const target = useMemo(() => toTarget(node), [node]);
	const queryClient = useQueryClient();
	const queryKey = useMemo(
		() => ["message-reactions", node.url, conversationId],
		[node.url, conversationId]
	);

	const query = useQuery({
		queryKey,
		queryFn: () => listReactions(target, conversationId as string),
		enabled: Boolean(conversationId),
		// Reactions arrive over the realtime room, so polling would only duplicate
		// what the socket already delivers.
		refetchOnWindowFocus: false,
		staleTime: 60 * 1000,
	});

	const buckets = useMemo(() => query.data ?? [], [query.data]);

	const byMessage = useMemo(() => {
		const map = new Map<string, ReactionBucket[]>();
		for (const bucket of buckets) {
			const list = map.get(bucket.messageId);
			if (list) {
				list.push(bucket);
			} else {
				map.set(bucket.messageId, [bucket]);
			}
		}
		return map;
	}, [buckets]);

	const write = useMutation<
		void,
		Error,
		{ emoji: string; messageId: string; op: "add" | "remove" },
		// The rollback snapshot. Declared explicitly because `onMutate`'s return
		// type is not inferred into `onError`'s `context` parameter.
		{ previous: ReactionBucket[] }
	>({
		mutationFn: ({ messageId, emoji, op }) =>
			op === "add"
				? addReaction(target, conversationId as string, messageId, emoji)
				: removeReaction(target, conversationId as string, messageId, emoji),
		// Roll back to the snapshot taken before the optimistic edit. Without this
		// a failed write leaves a chip on screen that no longer exists server-side,
		// and the next reload silently contradicts it.
		onError: (_err, _vars, context) => {
			if (context?.previous) {
				queryClient.setQueryData(queryKey, context.previous);
			}
		},
		onMutate: async ({ messageId, emoji, op }) => {
			await queryClient.cancelQueries({ queryKey });
			const previous =
				queryClient.getQueryData<ReactionBucket[]>(queryKey) ?? [];
			queryClient.setQueryData<ReactionBucket[]>(queryKey, (old) =>
				applyReactionDelta(old ?? [], messageId, emoji, op, true)
			);
			return { previous };
		},
	});

	const toggle = useCallback(
		(messageId: string, emoji: string) => {
			if (!conversationId) {
				return;
			}
			const existing = (
				queryClient.getQueryData<ReactionBucket[]>(queryKey) ?? []
			).find((b) => b.messageId === messageId && b.emoji === emoji);
			write.mutate({
				messageId,
				emoji,
				op: existing?.reactedByMe ? "remove" : "add",
			});
		},
		[conversationId, queryClient, queryKey, write]
	);

	const applyRealtimeFrame = useCallback(
		(data: unknown, myUserId: string | null) => {
			if (typeof data !== "object" || data === null) {
				return;
			}
			const frame = data as ReactionFrame;
			if (frame.type !== "reaction") {
				return;
			}
			const { message_id: messageId, emoji, op, user_id: userId } = frame;
			if (!(messageId && emoji) || (op !== "add" && op !== "remove")) {
				return;
			}
			// Our own write already moved the cache optimistically, and Core echoes
			// it back to us like any other member. Folding it in again would
			// double-count.
			if (userId && myUserId && userId === myUserId) {
				return;
			}
			queryClient.setQueryData<ReactionBucket[]>(queryKey, (old) =>
				applyReactionDelta(old ?? [], messageId, emoji, op, false)
			);
		},
		[queryClient, queryKey]
	);

	return { byMessage, applyRealtimeFrame, toggle };
}
