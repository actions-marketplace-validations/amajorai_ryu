import { SpacesView } from "@ryu/blocks/desktop/spaces";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { SpaceImportsPanel } from "../../src/components/spaces/SpaceImportsPanel.tsx";
import "../../src/index.css";

const now = Date.now();

const completedImports = [
	{
		id: "import_csv",
		space_id: "space_demo",
		source_type: "file",
		source_name: "customer-research.csv",
		source_format: "csv",
		destination_kind: "database",
		status: "completed",
		result_documents: [
			{ id: "db_customers", kind: "database", title: "Customer research" },
		],
		item_count: 248,
		byte_size: 82_440,
		message: null,
		created_at: now - 8 * 60_000,
		updated_at: now - 7 * 60_000,
		completed_at: now - 7 * 60_000,
	},
	{
		id: "import_pdf",
		space_id: "space_demo",
		source_type: "file",
		source_name: "research-brief.pdf",
		source_format: "pdf",
		destination_kind: "page",
		status: "completed",
		result_documents: [
			{ id: "page_brief", kind: "page", title: "Research brief" },
		],
		item_count: 1,
		byte_size: 1_845_248,
		message: null,
		created_at: now - 60 * 60_000,
		updated_at: now - 59 * 60_000,
		completed_at: now - 59 * 60_000,
	},
	{
		id: "import_github",
		space_id: "space_demo",
		source_type: "composio",
		source_name: "Open GitHub issues",
		source_format: "github",
		destination_kind: "database",
		status: "completed",
		result_documents: [
			{ id: "db_issues", kind: "database", title: "Open GitHub issues" },
		],
		item_count: 36,
		byte_size: 0,
		message: null,
		created_at: now - 24 * 60 * 60_000,
		updated_at: now - 24 * 60 * 60_000 + 5000,
		completed_at: now - 24 * 60 * 60_000 + 5000,
	},
];

let uploaded = false;
let composioImported = false;

function response(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json" },
	});
}

globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
	const url = String(input);
	if (url.endsWith("/api/composio/status")) {
		return response({
			configured: true,
			base_url: "https://backend.composio.dev/api/v3",
		});
	}
	if (url.endsWith("/api/composio/connections")) {
		return response({
			data: [
				{
					id: "connection_1",
					toolkit: "github",
					status: "ACTIVE",
					active: true,
				},
			],
		});
	}
	if (url.endsWith("/api/composio/toolkits")) {
		return response({
			data: [
				{
					slug: "github",
					name: "GitHub",
					description: "Issues, pull requests, and repositories",
					logo: null,
				},
			],
		});
	}
	if (url.includes("/api/composio/actions")) {
		if (!url.includes("tags=readOnlyHint")) {
			return response(
				{ error: "Missing provider-owned read-only filter" },
				400
			);
		}
		return response({
			data: [
				{
					name: "GITHUB_LIST_REPOSITORY_ISSUES",
					display_name: "List repository issues",
					description: "Read issues from a repository without changing GitHub.",
					toolkit: "github",
					no_auth: false,
					tags: ["readOnlyHint"],
					input_schema: {
						type: "object",
						required: ["owner", "repo"],
						properties: {
							owner: { type: "string", title: "Owner" },
							repo: { type: "string", title: "Repository" },
						},
					},
				},
				{
					name: "GITHUB_LIST_AND_MARK_NOTIFICATIONS",
					display_name: "List and mark notifications",
					description: "Lists notifications and marks them as read.",
					toolkit: "github",
					no_auth: false,
					tags: ["destructiveHint"],
					input_schema: { type: "object", properties: {} },
				},
			],
		});
	}
	if (
		url.endsWith("/api/spaces/space_demo/imports/files") &&
		init?.method === "POST"
	) {
		uploaded = true;
		return response(
			{
				import: {
					...completedImports[0],
					id: "import_new",
					source_name: "fresh-leads.csv",
					status: "pending",
					result_documents: [],
					item_count: 0,
					created_at: Date.now(),
					updated_at: Date.now(),
					completed_at: null,
				},
			},
			202
		);
	}
	if (
		url.endsWith("/api/spaces/space_demo/imports/composio") &&
		init?.method === "POST"
	) {
		const body = JSON.parse(String(init.body)) as {
			action?: string;
			arguments?: { owner?: string; repo?: string };
			destination_kind?: string;
			title?: string;
			toolkit?: string;
		};
		if (
			body.toolkit !== "github" ||
			body.action !== "GITHUB_LIST_REPOSITORY_ISSUES" ||
			body.arguments?.owner !== "amajorai" ||
			body.arguments.repo !== "ryu" ||
			body.destination_kind !== "auto" ||
			body.title !== "Ryu GitHub issues"
		) {
			return response({ error: "Unexpected Composio import request" }, 400);
		}
		composioImported = true;
		return response(
			{
				import: {
					...completedImports[2],
					id: "import_composio_new",
					source_name: "Ryu GitHub issues",
					status: "pending",
					result_documents: [],
					item_count: 0,
					created_at: Date.now(),
					updated_at: Date.now(),
					completed_at: null,
				},
			},
			202
		);
	}
	if (url.endsWith("/api/spaces/space_demo/imports")) {
		const newImport = uploaded
			? [
					{
						...completedImports[0],
						id: "import_new",
						source_name: "fresh-leads.csv",
						result_documents: [
							{ id: "db_leads", kind: "database", title: "Fresh leads" },
						],
						item_count: 3,
						byte_size: 45,
						created_at: Date.now(),
						updated_at: Date.now(),
						completed_at: Date.now(),
					},
				]
			: [];
		const newComposioImport = composioImported
			? [
					{
						...completedImports[2],
						id: "import_composio_new",
						source_name: "Ryu GitHub issues",
						result_documents: [
							{
								id: "db_ryu_issues",
								kind: "database",
								title: "Ryu GitHub issues",
							},
						],
						item_count: 17,
						created_at: Date.now(),
						updated_at: Date.now(),
						completed_at: Date.now(),
					},
				]
			: [];
		return response({
			space_id: "space_demo",
			imports: [...newComposioImport, ...newImport, ...completedImports],
		});
	}
	return response({ error: `Unrouted story request: ${url}` }, 404);
}) as typeof fetch;

function Story() {
	const [opened, setOpened] = useState("None");
	const onImportCompleted = useCallback(() => undefined, []);
	return (
		<div className="h-screen bg-background text-foreground">
			<div className="h-full min-h-0">
				<SpacesView
					detail={{
						space: {
							id: "space_demo",
							name: "Product research",
							description: "Customer interviews, briefs, and market data",
							documentCount: 14,
							retrievalMode: "vector",
						},
						documents: [],
						ingestTitle: "",
						ingestContent: "",
						searchQuery: "",
						importPanel: (
							<SpaceImportsPanel
								onImportCompleted={onImportCompleted}
								onManageConnections={() => setOpened("Connections")}
								onOpenDocument={(document) =>
									setOpened(`${document.kind}:${document.title}`)
								}
								spaceId="space_demo"
								target={{ url: "http://core.test", token: "story-token" }}
							/>
						),
					}}
					spaces={[
						{
							id: "space_demo",
							name: "Product research",
							description: "Customer interviews, briefs, and market data",
							documentCount: 14,
						},
					]}
				/>
			</div>
			<output className="sr-only" data-testid="opened-document">
				{opened}
			</output>
		</div>
	);
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
	},
});

createRoot(document.getElementById("root") as HTMLElement).render(
	<QueryClientProvider client={queryClient}>
		<Story />
	</QueryClientProvider>
);
