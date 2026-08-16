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
	searchSpace as apiSearchSpace,
	setDocumentIcon as apiSetDocumentIcon,
	setSpaceIcon as apiSetSpaceIcon,
	setSpaceRetrievalMode as apiSetSpaceRetrievalMode,
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
		retrievalMode?: RetrievalMode
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
	const [appDisabled, setAppDisabled] = useState<{
		app: string;
		message: string;
	} | null>(null);

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
			retrievalMode?: RetrievalMode
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
				retrievalMode
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

	const listDocuments = useCallback(
		(spaceId: string) => fetchDocuments({ url, token }, spaceId),
		[url, token]
	);

	const ingest = useCallback(
		async (spaceId: string, title: string, content: string) => {
			await apiIngestDocument({ url, token }, spaceId, title, content);
			// Refresh the list so the space's document count stays accurate.
			await reload();
			return fetchDocuments({ url, token }, spaceId);
		},
		[url, token, reload]
	);

	const search = useCallback(
		(spaceId: string, query: string) =>
			apiSearchSpace({ url, token }, spaceId, query),
		[url, token]
	);

	const createPage = useCallback(
		async (spaceId: string, title: string, parentId?: string) => {
			const id = await apiCreatePage({ url, token }, spaceId, title, parentId);
			// A parented "row page" is hidden from listings, so no reload is needed.
			if (!parentId) {
				await reload();
			}
			return id;
		},
		[url, token, reload]
	);

	const createDatabase = useCallback(
		async (spaceId: string, title: string) => {
			const id = await apiCreateDatabase({ url, token }, spaceId, title);
			await reload();
			return id;
		},
		[url, token, reload]
	);

	const createWhiteboard = useCallback(
		async (spaceId: string, title: string) => {
			const id = await apiCreateWhiteboard({ url, token }, spaceId, title);
			await reload();
			return id;
		},
		[url, token, reload]
	);

	const uploadFile = useCallback(
		(
			spaceId: string,
			file: File,
			opts?: { onProgress?: (fraction: number) => void; signal?: AbortSignal }
		) => apiUploadSpaceFile({ url, token }, spaceId, file, opts),
		[url, token]
	);

	const getDocument = useCallback(
		(spaceId: string, documentId: string) =>
			fetchDocument({ url, token }, spaceId, documentId),
		[url, token]
	);

	const saveDocument = useCallback(
		(spaceId: string, documentId: string, title: string, source: string) =>
			apiUpdateDocument({ url, token }, spaceId, documentId, title, source),
		[url, token]
	);

	const removeDocument = useCallback(
		async (spaceId: string, documentId: string) => {
			const removed = await apiDeleteDocument(
				{ url, token },
				spaceId,
				documentId
			);
			await reload();
			return removed;
		},
		[url, token, reload]
	);

	const setSpaceIcon = useCallback(
		async (id: string, icon: GlyphValue) => {
			await apiSetSpaceIcon({ url, token }, id, icon);
			setSpaces((prev) => prev.map((s) => (s.id === id ? { ...s, icon } : s)));
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
		},
		[url, token]
	);

	return {
		appDisabled,
		spaces,
		loading,
		error,
		reload,
		create,
		remove,
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
		setRetrievalMode,
		setDocumentIcon,
		uploadFile,
	};
}
