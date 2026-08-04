// Standalone browser story for the REAL `DocumentParsingSettings` — the Gateway
// dialog's "Document parsing" section.
//
// It exists because the bug this panel shipped with was invisible to every static
// check: the component was correct, its two reads were correct, and one of the
// routes they addressed was not registered in Core while the other had never
// existed. TypeScript cannot see that, and neither can a unit test of the client.
// What it produced was a panel that rendered its outer chrome and left the three
// rows that carry the actual answer blank.
//
// So the story mounts the component against BYTE-EXACT copies of what Core now
// answers — `parse_capability`'s JSON from `apps/core/src/document_parse.rs` and
// `list_capabilities`' from `apps/core/src/server/mod.rs` — and the spec asserts
// the rows are there with the node's own values in them. No Core, no Tauri, no
// seed data: `useActiveNode` falls back to the local node when there is no tab
// context, and `fetch` is stubbed below.
//
// HARNESS LIMIT: like the other stories, this bare harness ships no Tailwind
// plugin, so utility classes are never generated. This asserts CONTENT and
// STRUCTURE, not visual styling.

import { createRoot } from "react-dom/client";
import { DocumentParsingSettings } from "../../src/components/settings/DocumentParsingSettings.tsx";
import "../../src/index.css";

/**
 * `GET /api/documents/parse/capability` on a default install: markitdown is
 * default-ON and bound, its sidecar is asleep (so the 2s probe returns nothing and
 * `available` defaults to true), and `max_input_bytes` is `MAX_PARSE_BYTES` —
 * 32 MiB, Core's `MAX_UPLOAD_BYTES`.
 */
const CAPABILITY = {
	provider: "@ryu/markitdown",
	provider_name: "MarkItDown",
	available: true,
	extensions: [
		".csv",
		".htm",
		".html",
		".json",
		".log",
		".md",
		".markdown",
		".rst",
		".text",
		".toml",
		".tsv",
		".txt",
		".xml",
		".yaml",
		".yml",
	],
	builtin_extensions: [".txt", ".md", ".markdown", ".csv", ".json", ".html"],
	missing_dependencies: [],
	max_input_bytes: 32 * 1024 * 1024,
};

/** `GET /api/capabilities`, with a decoy layer so the filter is exercised. */
const CAPABILITIES = {
	capabilities: [
		{
			capability: "web.search",
			providers: [{ id: "com.ryu.exa", name: "Exa", version: "1.0.0" }],
			available: [],
			bound: "com.ryu.exa",
			overridden: false,
			selectable: true,
		},
		{
			capability: "document.parse",
			providers: [
				{
					id: "@ryu/markitdown",
					name: "MarkItDown",
					version: "0.1.3",
					is_default: true,
					// Both flags, matching the real wire shape: `document.parse` is
					// served by a sidecar route, never by verbs. A fixture carrying only
					// the false one describes a provider that serves NOTHING, which is
					// what a picker would grey out.
					serves_verbs: false,
					serves_route: true,
				},
			],
			available: [{ id: "@ryu/docling", name: "Docling", version: "2.0.0" }],
			bound: "@ryu/markitdown",
			overridden: false,
			selectable: true,
		},
	],
	verbs: [],
};

function json(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

// Installed BEFORE render so the panel's mount effect sees it. Unrouted paths
// answer 404 rather than falling through to the real network: a story that
// silently reached a live node would prove nothing about the payloads above.
globalThis.fetch = (async (input: RequestInfo | URL) => {
	const url = String(input instanceof Request ? input.url : input);
	if (url.includes("/api/documents/parse/capability")) {
		return json(CAPABILITY);
	}
	if (url.includes("/api/capabilities/bindings")) {
		return json({ overrides: {} });
	}
	if (url.includes("/api/capabilities")) {
		return json(CAPABILITIES);
	}
	return new Response(JSON.stringify({ error: `unrouted ${url}` }), {
		status: 404,
		headers: { "content-type": "application/json" },
	});
}) as typeof fetch;

function Story() {
	return (
		<div style={{ padding: 24, maxWidth: 640 }}>
			<DocumentParsingSettings />
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
