import { Database01Icon, StickyNote01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { FavoriteStar } from "@ryu/blocks/desktop/library.tsx";
import { Button } from "@ryu/ui/components/button.tsx";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
} from "@ryu/ui/components/context-menu.tsx";
import {
	EditorKit,
	type MyEditor,
} from "@ryu/ui/components/editor/editor-kit.tsx";
import { EditorStatic } from "@ryu/ui/components/editor/ui/editor-static.tsx";
import { ProjectFolder } from "@ryu/ui/components/project-folder.tsx";
import { Skeleton } from "@ryu/ui/components/skeleton.tsx";
import { Plate, usePlateEditor } from "platejs/react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useSpacesContext } from "@/src/contexts/SpacesContext.tsx";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import type {
	Space,
	SpaceDocument,
	SpaceDocumentContent,
} from "@/src/lib/api/spaces.ts";

const previewCache = new Map<string, SpaceDocumentContent>();

type DocumentListState =
	| { status: "error" }
	| { status: "loading" }
	| { documents: SpaceDocument[]; status: "ready" };
type PreviewState =
	| { status: "error" }
	| { status: "loading" }
	| { content: SpaceDocumentContent; status: "ready" };
type EditorKitPlugin = (typeof EditorKit)[number];
type MarkdownEditorPlugin = EditorKitPlugin & {
	api: { markdown: MyEditor["api"]["markdown"] };
	key: "markdown";
};

const markdownPlugin = EditorKit.find(
	(plugin): plugin is MarkdownEditorPlugin => plugin.key === "markdown"
);
const editableDocumentRawKinds = new Set(["", "page", "database"]);

function previewCacheKey(spaceId: string, document: SpaceDocument): string {
	return `${spaceId}:${document.id}:${document.updatedAt}`;
}

function previewCachePrefix(spaceId: string, documentId: string): string {
	return `${spaceId}:${documentId}:`;
}

export function storeSpaceDocumentPreview(
	cache: Map<string, SpaceDocumentContent>,
	spaceId: string,
	document: SpaceDocument,
	content: SpaceDocumentContent
): void {
	const key = previewCacheKey(spaceId, document);
	const prefix = previewCachePrefix(spaceId, document.id);
	for (const cachedKey of cache.keys()) {
		if (cachedKey.startsWith(prefix) && cachedKey !== key) {
			cache.delete(cachedKey);
		}
	}
	cache.set(key, content);
}

function isPreviewableDocument(document: SpaceDocument): boolean {
	return (
		(document.kind === "page" || document.kind === "database") &&
		editableDocumentRawKinds.has(document.rawKind)
	);
}

export function eligibleSpaceDocuments(
	documents: SpaceDocument[]
): SpaceDocument[] {
	return documents.filter(isPreviewableDocument);
}

export function spaceDocumentPath(
	spaceId: string,
	document: Pick<SpaceDocument, "id" | "kind" | "rawKind">
): string {
	const segment = document.kind === "database" ? "db" : "doc";
	return `/spaces/${spaceId}/${segment}/${document.id}`;
}

function PagePreview({ source }: { source: string }) {
	const editor = usePlateEditor({
		plugins: EditorKit,
		value: (currentEditor) =>
			currentEditor.getApi(markdownPlugin).markdown.deserialize(source || ""),
	});

	return (
		<Plate editor={editor}>
			<EditorStatic
				className="pointer-events-none max-h-44 overflow-hidden px-4 py-3 text-sm [&_.slate-p]:my-0 [&_.slate-p]:leading-5"
				editor={editor}
				variant="none"
			/>
		</Plate>
	);
}

function databaseCounts(
	source: string
): { columns: number; rows: number } | null {
	if (!source.trim()) {
		return null;
	}

	try {
		const parsed: unknown = JSON.parse(source);
		if (!isRecord(parsed)) {
			return null;
		}
		const columns = Array.isArray(parsed.columns) ? parsed.columns.length : 0;
		const rows = Array.isArray(parsed.rows) ? parsed.rows.length : 0;
		if (columns === 0 && rows === 0) {
			return null;
		}
		return { columns, rows };
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function DatabasePreview({ source }: { source: string }) {
	const counts = databaseCounts(source);

	return (
		<div className="flex min-h-32 flex-col justify-between bg-muted/30 p-4 text-sm">
			<div className="flex items-center gap-2 font-medium">
				<HugeiconsIcon className="size-4" icon={Database01Icon} />
				Database
			</div>
			{counts ? (
				<p className="text-muted-foreground text-xs">
					{counts.columns} {counts.columns === 1 ? "column" : "columns"} ·{" "}
					{counts.rows} {counts.rows === 1 ? "row" : "rows"}
				</p>
			) : (
				<p className="text-muted-foreground text-xs">Empty database</p>
			)}
		</div>
	);
}

function FailedPreview({ document }: { document: SpaceDocument }) {
	return (
		<div className="flex min-h-32 flex-col justify-between bg-muted/30 p-4 text-sm">
			<p className="font-medium">{document.title || "Untitled"}</p>
			<p className="text-muted-foreground text-xs">Preview unavailable</p>
		</div>
	);
}

function LoadingPreview({ document }: { document: SpaceDocument }) {
	return (
		<div
			aria-label={`Loading preview for ${document.title || "Untitled"}`}
			className="flex min-h-32 flex-col gap-3 bg-muted/30 p-4"
		>
			<Skeleton className="h-4 w-2/3" />
			<Skeleton className="h-3 w-full" />
			<Skeleton className="h-3 w-4/5" />
		</div>
	);
}

function DocumentPreview({
	document,
	state,
}: {
	document: SpaceDocument;
	state: PreviewState;
}) {
	if (state.status === "loading") {
		return <LoadingPreview document={document} />;
	}
	if (state.status === "error") {
		return <FailedPreview document={document} />;
	}
	if (document.kind === "database") {
		return <DatabasePreview source={state.content.source} />;
	}
	return <PagePreview source={state.content.source} />;
}

export function SpaceProjectFolder({
	contextMenu,
	favorited,
	onToggleFavorite,
	space,
}: {
	contextMenu?: ReactNode;
	favorited: boolean;
	onToggleFavorite: () => void;
	space: Space;
}) {
	const {
		createDatabase,
		createPage,
		documentRevisions,
		getDocument,
		listDocuments,
	} = useSpacesContext();
	const { openTab } = useTabsContext();
	const documentRevision = documentRevisions.get(space.id) ?? 0;
	const [documentList, setDocumentList] = useState<DocumentListState>({
		status: "loading",
	});
	const [loadAttempt, setLoadAttempt] = useState(0);
	const [previewStates, setPreviewStates] = useState<Map<string, PreviewState>>(
		() => new Map()
	);

	useEffect(() => {
		let cancelled = false;

		const load = async () => {
			setDocumentList({ status: "loading" });
			setPreviewStates(new Map());
			let eligible: SpaceDocument[];
			try {
				eligible = eligibleSpaceDocuments(await listDocuments(space.id));
			} catch {
				if (!cancelled) {
					setDocumentList({ status: "error" });
				}
				return;
			}
			if (cancelled) {
				return;
			}

			setDocumentList({ documents: eligible, status: "ready" });
			const previewDocuments = eligible.slice(0, 5);
			const initialStates = new Map<string, PreviewState>();
			const uncachedDocuments: SpaceDocument[] = [];
			for (const document of previewDocuments) {
				const cached = previewCache.get(previewCacheKey(space.id, document));
				if (cached) {
					initialStates.set(document.id, {
						content: cached,
						status: "ready",
					});
				} else {
					initialStates.set(document.id, { status: "loading" });
					uncachedDocuments.push(document);
				}
			}
			setPreviewStates(initialStates);

			const requests = uncachedDocuments.map(async (document) => {
				try {
					const content = await getDocument(space.id, document.id);
					if (cancelled) {
						return;
					}
					storeSpaceDocumentPreview(previewCache, space.id, document, content);
					setPreviewStates((current) => {
						const next = new Map(current);
						next.set(document.id, { content, status: "ready" });
						return next;
					});
				} catch {
					if (!cancelled) {
						setPreviewStates((current) => {
							const next = new Map(current);
							next.set(document.id, { status: "error" });
							return next;
						});
					}
				}
			});
			await Promise.allSettled(requests);
		};

		void load();
		return () => {
			cancelled = true;
		};
	}, [documentRevision, getDocument, listDocuments, loadAttempt, space.id]);

	const documents =
		documentList.status === "ready" ? documentList.documents : [];

	const createDocument = async (kind: "page" | "database") => {
		const title = "Untitled";
		const id =
			kind === "page"
				? await createPage(space.id, title)
				: await createDatabase(space.id, title);
		openTab(
			spaceDocumentPath(space.id, {
				id,
				kind,
				rawKind: kind,
			}),
			{ title }
		);
	};

	const previews = documents.slice(0, 5).map((document) => ({
		content: (expanded: boolean) => (
			<div className={expanded ? "min-h-40" : "min-h-28"}>
				<DocumentPreview
					document={document}
					state={previewStates.get(document.id) ?? { status: "loading" }}
				/>
			</div>
		),
		id: document.id,
		label: `Open ${document.title || "Untitled"}`,
		onClick: () =>
			openTab(spaceDocumentPath(space.id, document), {
				title: document.title,
			}),
	}));

	const folder = (
		<div className="group relative w-fit">
			<ProjectFolder
				count={documents.length}
				description={space.description ?? "Pages and databases in this Space."}
				emptyContent={(closeBeforeNavigation) => {
					if (documentList.status === "loading") {
						return (
							<div className="flex min-h-32 flex-col gap-3 rounded-2xl border p-4">
								<p className="font-medium text-sm">Loading documents…</p>
								<Skeleton className="h-4 w-2/3" />
								<Skeleton className="h-4 w-full" />
							</div>
						);
					}
					if (documentList.status === "error") {
						return (
							<div className="flex min-h-32 flex-col items-start justify-center gap-2 rounded-2xl border border-dashed p-4">
								<p className="font-medium text-sm">Couldn’t load documents</p>
								<p className="text-muted-foreground text-xs">
									Check the connection and try again.
								</p>
								<Button
									onClick={() => setLoadAttempt((value) => value + 1)}
									size="sm"
								>
									Try again
								</Button>
							</div>
						);
					}
					return (
						<div className="flex min-h-32 flex-col items-start justify-center gap-2 rounded-2xl border border-dashed p-4">
							<p className="font-medium text-sm">No documents yet</p>
							<div className="flex flex-wrap gap-2">
								<Button
									onClick={() => {
										closeBeforeNavigation();
										void createDocument("page");
									}}
									size="sm"
								>
									<HugeiconsIcon className="size-4" icon={StickyNote01Icon} />
									Create page
								</Button>
								<Button
									onClick={() => {
										closeBeforeNavigation();
										void createDocument("database");
									}}
									size="sm"
									variant="outline"
								>
									<HugeiconsIcon className="size-4" icon={Database01Icon} />
									Create database
								</Button>
							</div>
						</div>
					);
				}}
				itemLabel="document"
				previews={previews}
				title={space.name}
			/>
			<FavoriteStar
				className="absolute top-2 right-2 bg-background/70 backdrop-blur-sm"
				favorited={favorited}
				onToggle={onToggleFavorite}
			/>
		</div>
	);

	if (!contextMenu) {
		return folder;
	}
	return (
		<ContextMenu>
			<ContextMenuTrigger render={folder} />
			<ContextMenuContent align="end">{contextMenu}</ContextMenuContent>
		</ContextMenu>
	);
}
