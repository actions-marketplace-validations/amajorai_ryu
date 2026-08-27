export interface AssistantDocReference {
	href: string;
	keywords: readonly string[];
	summary: string;
	title: string;
}

/**
 * Small, public-only grounding index shipped with the widget. It keeps the
 * first answer useful before a docs fetch and gives the local model bounded,
 * auditable context instead of sending the whole site into a prompt.
 */
export const RYU_DOC_REFERENCES: readonly AssistantDocReference[] = [
	{
		href: "/docs/start-here/architecture/three-products",
		keywords: ["ryu", "platform", "product", "what", "company", "ai"],
		summary:
			"Ryu is a governed production AI platform: teams build AI apps with reusable SDK and platform primitives while Ryu provides running, access control, and monitoring. Core runs the app runtime and Gateway governs model and tool access.",
		title: "What is Ryu?",
	},
	{
		href: "/docs/extend/develop/sdk",
		keywords: ["sdk", "build", "app", "developer", "typescript", "runnable"],
		summary:
			"The Ryu SDK lets a team describe an app and reusable Runnable capabilities, validate its manifest, and run it on Ryu Core or through Gateway-owned execution. The app owns its product logic; Ryu owns the governed runtime boundary.",
		title: "Build with the Ryu SDK",
	},
	{
		href: "/docs/extend/develop/extensions/support-widget",
		keywords: ["widget", "support", "chat", "website", "embed", "customer"],
		summary:
			"A support widget can be packaged as a Ryu App with a browser UI and a governed Runnable backend. The widget calls the same tool and access-control boundary as a larger AI product, so teams can start small and keep operations consistent.",
		title: "Ship a support widget",
	},
	{
		href: "/docs/surfaces/browser-extension",
		keywords: [
			"browser",
			"local",
			"transformers",
			"webgpu",
			"wasm",
			"model",
			"extension",
		],
		summary:
			"Ryu's browser extension can run reviewed Transformers.js text-generation models locally with WebGPU when available and WASM fallback otherwise. Models are downloaded into the browser cache; local generation stays in the browser unless the user separately links a turn to Core.",
		title: "Run a model in the browser",
	},
	{
		href: "/docs/surfaces/webapp",
		keywords: ["node", "connect", "core", "local", "run", "browser", "token"],
		summary:
			"A browser surface can connect directly to a user's running Ryu Core node. The browser sends an explicit Bearer node token to the node, keeps that token in the tab, and uses Core's chat stream; it does not send the token through Ryu's control plane.",
		title: "Connect a running local node",
	},
	{
		href: "/docs/extend/mcp/llms",
		keywords: ["docs", "fumadocs", "mcp", "search", "llms", "documentation"],
		summary:
			"Ryu Docs exposes a public Markdown and MCP surface so developers and agents can search documentation without scraping rendered pages. The widget uses the same public documentation vocabulary and links back to the source page.",
		title: "Use the Ryu documentation surface",
	},
];

const STOP_WORDS = new Set([
	"a",
	"about",
	"and",
	"can",
	"do",
	"for",
	"how",
	"i",
	"in",
	"is",
	"it",
	"me",
	"of",
	"on",
	"the",
	"to",
	"use",
	"what",
	"with",
	"you",
]);

function terms(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

export function findRelevantDocs(
	query: string,
	limit = 3
): AssistantDocReference[] {
	const queryTerms = terms(query);
	if (queryTerms.length === 0) {
		return RYU_DOC_REFERENCES.slice(0, limit);
	}

	return RYU_DOC_REFERENCES.map((reference, index) => {
		const titleTerms = new Set(terms(reference.title));
		const keywordTerms = new Set(reference.keywords);
		const summaryTerms = new Set(terms(reference.summary));
		const score = queryTerms.reduce((total, term) => {
			if (titleTerms.has(term)) {
				return total + 4;
			}
			if (keywordTerms.has(term)) {
				return total + 2;
			}
			return total + (summaryTerms.has(term) ? 1 : 0);
		}, 0);
		return { index, reference, score };
	})
		.sort((left, right) => right.score - left.score || left.index - right.index)
		.slice(0, limit)
		.map(({ reference }) => reference);
}

export function buildLocalAssistantPrompt(
	question: string,
	references: readonly AssistantDocReference[]
): string {
	const context = references
		.map(
			(reference) =>
				`[${reference.title}]\n${reference.summary}\nSource: ${reference.href}`
		)
		.join("\n\n");
	return [
		"You are the Ryu documentation assistant.",
		"Answer only from the public context below. Be concise, concrete, and honest about uncertainty. Do not invent pricing, private implementation details, or capabilities that are not in the context.",
		"If the question is not answered by the context, say that and point the reader to the closest source.",
		"",
		"Public context:",
		context,
		"",
		`Question: ${question.trim()}`,
	].join("\n");
}

export function deterministicAssistantAnswer(
	query: string,
	references: readonly AssistantDocReference[]
): string {
	const normalized = query.toLowerCase();
	if (
		normalized.includes("what is ryu") ||
		normalized.includes("what does ryu") ||
		normalized.includes("about ryu")
	) {
		return (
			RYU_DOC_REFERENCES[0]?.summary ??
			"Ryu is a production AI platform for building and operating governed AI apps."
		);
	}
	const first = references[0];
	if (!first) {
		return "I could not find a public Ryu document for that question.";
	}
	return `${first.summary} See “${first.title}” for the full explanation.`;
}

export function resolveDocHref(
	baseUrl: string | undefined,
	path: string
): string {
	const base = baseUrl?.trim().replace(/\/$/, "");
	return base ? `${base}${path}` : path;
}
