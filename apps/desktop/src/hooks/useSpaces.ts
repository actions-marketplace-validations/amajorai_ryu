import type { GlyphValue } from "@ryu/ui/components/glyph.ts";
import { useCallback, useEffect, useState } from "react";
import { type ApiTarget, AppDisabledError } from "@/src/lib/api/client.ts";
import {
	createDatabase as apiCreateDatabase,
	createPage as apiCreatePage,
	createSpace as apiCreateSpace,
	createWhiteboard as apiCreateWhiteboard,
	deleteDocument as apiDeleteDocument,
	deleteSpace as apiDeleteSpace,
	ingestDocument as apiIngestDocument,
	renameSpace as apiRenameSpace,
	searchSpace as apiSearchSpace,
	setDocumentIcon as apiSetDocumentIcon,
	setSpaceIcon as apiSetSpaceIcon,
	setSpaceRetrievalMode as apiSetSpaceRetrievalMode,
	setSpaceVisibility as apiSetSpaceVisibility,
	updateDocument as apiUpdateDocument,
	uploadSpaceFile as apiUploadSpaceFile,
	fetchDocument,
	fetchDocuments,
	fetchSpaces,
	type RetrievalMode,
	type RetrievalModeChange,
	type RetrievalModeProgress,
	type Space,
	type SpaceDocument,
	type SpaceDocumentContent,
	type SpaceMatch,
	type UploadedSpaceFile,
} from "@/src/lib/api/spaces.ts";
import { useCoreRefresh } from "@/src/lib/core-refresh.ts";
import { useEntityCap } from "@/src/lib/gating/useEntityCap.ts";
import type { ResourceVisibility } from "@/src/lib/resource-visibility.ts";
import { useActiveNode } from "./useActiveNode.ts";

export interface UseSpacesResult {
	/** Set when Core refused the spaces routes because the Spaces App is disabled
	 *  (`503 app_disabled`). Carries the id to enable + the message. */
	appDisabled: { app: string; message: string } | null;
	/**
	 * Create a Space. Pass `retrievalMode` only when the user explicitly picked
	 * one — omitting it lets Core apply the node-wide `rag_strategy` default,
	 * which is the only way that operator setting can still take effect.
	 *
	 * Resolves to the mode Core actually stamped (echoed by the create response),
	 * or `null` when the managed-tier cap blocked the create so no Space exists.
	 */
	create: (
		name: string,
		description: string | null,
		retrievalMode?: RetrievalMode,
		visibility?: ResourceVisibility
	) => Promise<RetrievalMode | null>;
	/** Create a new blank database (data grid); returns its document id. */
	createDatabase: (spaceId: string, title: string) => Promise<string>;
	/**
	 * Create a new blank markdown page; returns its document id. Pass `parentId`
	 * (a database id) to create a hidden database "row page".
	 */
	createPage: (
		spaceId: string,
		title: string,
		parentId?: string
	) => Promise<string>;
	/** Create a new blank whiteboard (Excalidraw); returns its document id. */
	createWhiteboard: (spaceId: string, title: string) => Promise<string>;
	/**
	 * Per-Space invalidation signal for document consumers. A value changes after
	 * each successful document mutation, including saves that do not update the
	 * parent Space timestamp.
	 */
	documentRevisions: ReadonlyMap<string, number>;
	error: string | null;
	/** Load a single page's full markdown source for editing. */
	getDocument: (
		spaceId: string,
		documentId: string
	) => Promise<SpaceDocumentContent>;
	ingest: (
		spaceId: string,
		title: string,
		content: string
	) => Promise<SpaceDocument[]>;
	listDocuments: (spaceId: string) => Promise<SpaceDocument[]>;
	loading: boolean;
	reload: () => Promise<void>;
	remove: (id: string) => Promise<void>;
	/** Delete a single page. */
	removeDocument: (spaceId: string, documentId: string) => Promise<boolean>;
	/** Rename a user-created Space and update the shared list in place. */
	rename: (id: string, name: string) => Promise<void>;
	/** Persist a page's markdown (Core re-embeds on save). Callers debounce. */
	saveDocument: (
		spaceId: string,
		documentId: string,
		title: string,
		source: string
	) => Promise<void>;
	search: (spaceId: string, query: string) => Promise<SpaceMatch[]>;
	/** Set or clear a document glyph without re-embedding. */
	setDocumentIcon: (
		spaceId: string,
		documentId: string,
		icon: GlyphValue
	) => Promise<void>;
	/**
	 * Switch a Space's retrieval mode. Core rebuilds (or drops) the Space's entity
	 * graph as part of the call, so this is slow on a large Space and the caller
	 * must keep its control disabled until it resolves. Resolves to what the switch
	 * actually did, so the UI can report the consequence instead of implying one.
	 */
	setRetrievalMode: (
		id: string,
		mode: RetrievalMode,
		options?: {
			onProgress?: (progress: RetrievalModeProgress) => void;
			signal?: AbortSignal;
		}
	) => Promise<RetrievalModeChange>;
	/** Set or clear a Space glyph. */
	setSpaceIcon: (id: string, icon: GlyphValue) => Promise<void>;
	/** Set a Space's owner-only or team visibility. */
	setSpaceVisibility: (
		id: string,
		visibility: ResourceVisibility,
		teamId?: string | null
	) => Promise<void>;
	spaces: Space[];
	/**
	 * Store a binary file as a file document in a Space.
	 *
	 * Unlike every other mutation here this does **not** `reload()`, because it is
	 * the one that is normally called in a batch: N files would mean N full
	 * refetches, each one re-rendering the list mid-upload. The caller reloads once
	 * when its batch settles — {@link reload} is exposed for exactly that.
	 *
	 * Resolves to the stored document *and* its extraction outcome; a resolved
	 * promise means the bytes landed, not that the contents are searchable.
	 */
	uploadFile: (
		spaceId: string,
		file: File,
		opts?: { onProgress?: (fraction: number) => void; signal?: AbortSignal }
	) => Promise<UploadedSpaceFile>;
}

/// Loads Spaces from the active Core node and exposes create/delete plus the
/// per-space document and search operations. Mutations keep the in-memory list
/// in sync so the UI reflects changes (e.g. document counts) without a manual
/// reload.
export function useSpaces(): UseSpacesResult {
	const activeNode = useActiveNode();
	const { url } = activeNode;
	const token = activeNode.token ?? null;

	const { guard } = useEntityCap();

	const [spaces, setSpaces] = useState<Space[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [documentRevisions, setDocumentRevisions] = useState<
		ReadonlyMap<string, number>
	>(() => new Map());
	const [appDisabled, setAppDisabled] = useState<{
		app: string;
		message: string;
	} | null>(null);
	const bumpDocumentRevision = useCallback((spaceId: string) => {
		setDocumentRevisions((current) => {
			const next = new Map(current);
			next.set(spaceId, (current.get(spaceId) ?? 0) + 1);
			return next;
		});
	}, []);

	const reload = useCallback(async () => {
		setLoading(true);
		setError(null);
		setAppDisabled(null);
		const target: ApiTarget = { url, token };
		try {
			setSpaces(await fetchSpaces(target));
		} catch (e) {
			// A disabled-app 503 is not a load failure — it has its own actionable
			// surface (the Enable prompt), so route it there instead of `error`.
			if (e instanceof AppDisabledError) {
				setAppDisabled({ app: e.app, message: e.message });
			} else {
				setError(e instanceof Error ? e.message : "Failed to load spaces");
			}
		} finally {
			setLoading(false);
		}
	}, [url, token]);

	useEffect(() => {
		reload().catch(() => undefined);
	}, [reload]);

	// Auto-recover when Core reconnects or the user hits "Refresh all".
	useCoreRefresh(reload);

	const create = useCallback(
		async (
			name: string,
			description: string | null,
			retrievalMode?: RetrievalMode,
			visibility?: ResourceVisibility
		) => {
			// Managed-path numeric cap (free tier). Blocks + opens the upgrade modal
			// when at the limit; a no-op off the managed path (self-host uncapped).
			if (!guard("maxSpaces", spaces.length)) {
				return null;
			}
			const created = await apiCreateSpace(
				{ url, token },
				name,
				description,
				retrievalMode,
				visibility
			);
			await reload();
			return created.retrievalMode;
		},
		[url, token, reload, guard, spaces.length]
	);

	const remove = useCallback(
		async (id: string) => {
			await apiDeleteSpace({ url, token }, id);
			setSpaces((prev) => prev.filter((s) => s.id !== id));
		},
		[url, token]
	);

	const rename = useCallback(
		async (id: string, name: string) => {
			await apiRenameSpace({ url, token }, id, name);
			setSpaces((prev) =>
				prev.map((space) =>
					space.id === id ? { ...space, name, updatedAt: Date.now() } : space
				)
			);
		},
		[url, token]
	);

	const listDocuments = useCallback(
		(spaceId: string) => fetchDocuments({ url, token }, spaceId),
		[url, token]
	);

	const ingest = useCallback(
		async (spaceId: string, title: string, content: string) => {
			await apiIngestDocument({ url, token }, spaceId, title, content);
			bumpDocumentRevision(spaceId);
			// Refresh the list so the space's document count stays accurate.
			await reload();
			return fetchDocuments({ url, token }, spaceId);
		},
		[url, token, bumpDocumentRevision, reload]
	);

	const search = useCallback(
		(spaceId: string, query: string) =>
			apiSearchSpace({ url, token }, spaceId, query),
		[url, token]
	);

	const createPage = useCallback(
		async (spaceId: string, title: string, parentId?: string) => {
			const id = await apiCreatePage({ url, token }, spaceId, title, parentId);
			bumpDocumentRevision(spaceId);
			// A parented "row page" is hidden from listings, so no reload is needed.
			if (!parentId) {
				await reload();
			}
			return id;
		},
		[url, token, bumpDocumentRevision, reload]
	);

	const createDatabase = useCallback(
		async (spaceId: string, title: string) => {
			const id = await apiCreateDatabase({ url, token }, spaceId, title);
			bumpDocumentRevision(spaceId);
			await reload();
			return id;
		},
		[url, token, bumpDocumentRevision, reload]
	);

	const createWhiteboard = useCallback(
		async (spaceId: string, title: string) => {
			const id = await apiCreateWhiteboard({ url, token }, spaceId, title);
			bumpDocumentRevision(spaceId);
			await reload();
			return id;
		},
		[url, token, bumpDocumentRevision, reload]
	);

	const uploadFile = useCallback(
		async (
			spaceId: string,
			file: File,
			opts?: { onProgress?: (fraction: number) => void; signal?: AbortSignal }
		) => {
			const uploaded = await apiUploadSpaceFile(
				{ url, token },
				spaceId,
				file,
				opts
			);
			bumpDocumentRevision(spaceId);
			return uploaded;
		},
		[url, token, bumpDocumentRevision]
	);

	const getDocument = useCallback(
		(spaceId: string, documentId: string) =>
			fetchDocument({ url, token }, spaceId, documentId),
		[url, token]
	);

	const saveDocument = useCallback(
		async (
			spaceId: string,
			documentId: string,
			title: string,
			source: string
		) => {
			await apiUpdateDocument(
				{ url, token },
				spaceId,
				documentId,
				title,
				source
			);
			bumpDocumentRevision(spaceId);
		},
		[url, token, bumpDocumentRevision]
	);

	const removeDocument = useCallback(
		async (spaceId: string, documentId: string) => {
			const removed = await apiDeleteDocument(
				{ url, token },
				spaceId,
				documentId
			);
			if (removed) {
				bumpDocumentRevision(spaceId);
			}
			await reload();
			return removed;
		},
		[url, token, bumpDocumentRevision, reload]
	);

	const setSpaceIcon = useCallback(
		async (id: string, icon: GlyphValue) => {
			await apiSetSpaceIcon({ url, token }, id, icon);
			setSpaces((prev) => prev.map((s) => (s.id === id ? { ...s, icon } : s)));
		},
		[url, token]
	);

	const setSpaceVisibility = useCallback(
		async (
			id: string,
			visibility: ResourceVisibility,
			teamId?: string | null
		) => {
			await apiSetSpaceVisibility({ url, token }, id, visibility, teamId);
			setSpaces((prev) =>
				prev.map((space) =>
					space.id === id
						? {
								...space,
								visibility,
								teamId: visibility === "team" ? (teamId ?? null) : null,
							}
						: space
				)
			);
		},
		[url, token]
	);

	const setRetrievalMode = useCallback(
		async (id: string, mode: RetrievalMode, options = {}) => {
			const change = await apiSetSpaceRetrievalMode(
				{ url, token },
				id,
				mode,
				options
			);
			// Patch in place rather than `reload()`: the switch changes no document
			// counts, and a full refetch would blank the detail pane mid-interaction.
			// `change.mode` (Core's echo), never the requested `mode` — the list must
			// show what the node has, not what this client asked for.
			setSpaces((prev) =>
				prev.map((s) =>
					s.id === id ? { ...s, retrievalMode: change.mode } : s
				)
			);
			return change;
		},
		[url, token]
	);

	const setDocumentIcon = useCallback(
		async (spaceId: string, documentId: string, icon: GlyphValue) => {
			await apiSetDocumentIcon({ url, token }, spaceId, documentId, icon);
			bumpDocumentRevision(spaceId);
		},
		[url, token, bumpDocumentRevision]
	);

	return {
		appDisabled,
		documentRevisions,
		spaces,
		loading,
		error,
		reload,
		create,
		remove,
		rename,
		listDocuments,
		ingest,
		search,
		createPage,
		createDatabase,
		createWhiteboard,
		getDocument,
		saveDocument,
		removeDocument,
		setSpaceIcon,
		setSpaceVisibility,
		setRetrievalMode,
		setDocumentIcon,
		uploadFile,
	};
}
