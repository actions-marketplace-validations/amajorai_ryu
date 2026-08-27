import type { TDiscussion } from "@ryu/ui/components/editor/plugins/discussion-kit";
import type { TComment } from "@ryu/ui/components/editor/ui/comment";
import type { Doc, Map as YMap } from "yjs";

const DISCUSSIONS_MAP = "ryu:discussion-meta";
const COMMENTS_MAP = "ryu:discussion-comments";
const USERS_MAP = "ryu:discussion-users";

interface DiscussionMetadataWire {
	createdAt: string;
	documentContent?: string;
	id: string;
	isResolved: boolean;
	userId: string;
}

interface CommentWire extends Omit<TComment, "createdAt"> {
	createdAt: string;
	updatedAt?: string;
}

export interface DiscussionUser {
	avatarUrl?: string;
	hue?: number;
	id: string;
	name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return null;
	}
}

function parseDate(value: unknown): Date | null {
	if (typeof value !== "string") {
		return null;
	}
	const date = new Date(value);
	return Number.isNaN(date.valueOf()) ? null : date;
}

function parseMetadata(value: string): DiscussionMetadataWire | null {
	const parsed = parseJson(value);
	if (
		!isRecord(parsed) ||
		typeof parsed.id !== "string" ||
		typeof parsed.createdAt !== "string" ||
		typeof parsed.isResolved !== "boolean" ||
		typeof parsed.userId !== "string" ||
		(parsed.documentContent !== undefined &&
			typeof parsed.documentContent !== "string")
	) {
		return null;
	}
	return {
		createdAt: parsed.createdAt,
		documentContent: parsed.documentContent,
		id: parsed.id,
		isResolved: parsed.isResolved,
		userId: parsed.userId,
	};
}

function parseComment(value: string): TComment | null {
	const parsed = parseJson(value);
	const createdAt = isRecord(parsed) ? parseDate(parsed.createdAt) : null;
	if (
		!(isRecord(parsed) && createdAt && Array.isArray(parsed.contentRich)) ||
		typeof parsed.discussionId !== "string" ||
		typeof parsed.id !== "string" ||
		typeof parsed.isEdited !== "boolean" ||
		typeof parsed.userId !== "string"
	) {
		return null;
	}
	return {
		contentRich: parsed.contentRich,
		createdAt,
		discussionId: parsed.discussionId,
		id: parsed.id,
		isEdited: parsed.isEdited,
		userId: parsed.userId,
	};
}

function parseUser(value: string): DiscussionUser | null {
	const parsed = parseJson(value);
	if (
		!isRecord(parsed) ||
		typeof parsed.id !== "string" ||
		typeof parsed.name !== "string" ||
		(parsed.avatarUrl !== undefined && typeof parsed.avatarUrl !== "string") ||
		(parsed.hue !== undefined && typeof parsed.hue !== "number")
	) {
		return null;
	}
	return {
		avatarUrl: parsed.avatarUrl,
		hue: parsed.hue,
		id: parsed.id,
		name: parsed.name,
	};
}

function commentKey(comment: TComment): string {
	return `${comment.discussionId}:${comment.id}`;
}

export class DiscussionCollabStore {
	private readonly comments: YMap<string>;
	private readonly discussions: YMap<string>;
	private readonly users: YMap<string>;

	constructor(private readonly document: Doc) {
		this.comments = document.getMap<string>(COMMENTS_MAP);
		this.discussions = document.getMap<string>(DISCUSSIONS_MAP);
		this.users = document.getMap<string>(USERS_MAP);
	}

	readDiscussions(): TDiscussion[] {
		const commentsByDiscussion = new Map<string, TComment[]>();
		for (const value of this.comments.values()) {
			const comment = parseComment(value);
			if (!comment) {
				continue;
			}
			const comments = commentsByDiscussion.get(comment.discussionId) ?? [];
			comments.push(comment);
			commentsByDiscussion.set(comment.discussionId, comments);
		}

		const result: TDiscussion[] = [];
		for (const value of this.discussions.values()) {
			const metadata = parseMetadata(value);
			const createdAt = metadata ? parseDate(metadata.createdAt) : null;
			if (!(metadata && createdAt)) {
				continue;
			}
			const comments = commentsByDiscussion.get(metadata.id) ?? [];
			comments.sort(
				(left, right) => left.createdAt.valueOf() - right.createdAt.valueOf()
			);
			result.push({
				comments,
				createdAt,
				documentContent: metadata.documentContent,
				id: metadata.id,
				isResolved: metadata.isResolved,
				userId: metadata.userId,
			});
		}
		return result.sort(
			(left, right) => left.createdAt.valueOf() - right.createdAt.valueOf()
		);
	}

	readUsers(): Record<string, DiscussionUser> {
		const result: Record<string, DiscussionUser> = {};
		for (const value of this.users.values()) {
			const user = parseUser(value);
			if (user) {
				result[user.id] = user;
			}
		}
		return result;
	}

	writeDiscussions(discussions: TDiscussion[]): void {
		this.document.transact(() => {
			const discussionIds = new Set(
				discussions.map((discussion) => discussion.id)
			);
			const commentIds = new Set(
				discussions.flatMap((discussion) => discussion.comments.map(commentKey))
			);

			for (const id of this.discussions.keys()) {
				if (!discussionIds.has(id)) {
					this.discussions.delete(id);
				}
			}
			for (const id of this.comments.keys()) {
				if (!commentIds.has(id)) {
					this.comments.delete(id);
				}
			}

			for (const discussion of discussions) {
				const metadata: DiscussionMetadataWire = {
					createdAt: discussion.createdAt.toISOString(),
					documentContent: discussion.documentContent,
					id: discussion.id,
					isResolved: discussion.isResolved,
					userId: discussion.userId,
				};
				this.discussions.set(discussion.id, JSON.stringify(metadata));
				for (const comment of discussion.comments) {
					const wire: CommentWire = {
						...comment,
						createdAt: comment.createdAt.toISOString(),
					};
					this.comments.set(commentKey(comment), JSON.stringify(wire));
				}
			}
		});
	}

	writeUser(user: DiscussionUser): void {
		this.users.set(user.id, JSON.stringify(user));
	}

	observe(onChange: () => void): () => void {
		let active = true;
		let queued = false;
		const queueChange = () => {
			if (queued) {
				return;
			}
			queued = true;
			queueMicrotask(() => {
				queued = false;
				if (active) {
					onChange();
				}
			});
		};
		this.comments.observe(queueChange);
		this.discussions.observe(queueChange);
		this.users.observe(queueChange);
		return () => {
			active = false;
			this.comments.unobserve(queueChange);
			this.discussions.unobserve(queueChange);
			this.users.unobserve(queueChange);
		};
	}
}
