import { AgentActivity } from "@ryu/ui/components/agents/agent-activity";
import { formatNumber } from "@ryu/ui/lib/number-format.ts";
import { memo, useMemo } from "react";
import { useToolComplete } from "../hooks/use-tool-complete.ts";
import type { SourceType } from "../icons/source-icons.tsx";
import type { StepState, TimelineStep } from "../types/timeline.ts";
import {
	mapToolInvocationToStep,
	mapToolStateToStepState,
} from "../utils/tool-adapters.ts";

export interface SearchResult {
	date: string;
	source: SourceType;
	title: string;
}

export interface SearchGroupRichProps {
	/**
	 * Human-readable result text, used when the tool returns prose/markdown
	 * rather than a structured list (the common ACP WebSearch case). Shown in the
	 * panel body and — when there are no titled `results` — keeps the row from
	 * falsely claiming "0 results".
	 */
	bodyText?: string;
	defaultOpen?: boolean;
	onStepComplete: (id: string) => void;
	results?: SearchResult[];
	stepStates: Record<string, StepState>;
	toolSteps: Extract<TimelineStep, { type: "tool-call" }>[];
}

/** Truthful completion label for a finished search. */
function searchCompleteLabel(count: number, hasBody: boolean): string {
	if (count > 0) {
		return `Found ${formatNumber(count)} results`;
	}
	if (hasBody) {
		return "Search complete";
	}
	return "No results";
}

export function SearchGroupRich({
	toolSteps,
	stepStates,
	onStepComplete,
	results = [],
	bodyText = "",
	defaultOpen,
}: SearchGroupRichProps) {
	const anyAnimating = toolSteps.some((s) => stepStates[s.id] === "animating");
	const searchQuery =
		toolSteps.find((s) => s.searchQuery)?.searchQuery ?? "searching...";
	const totalResults = results.length;
	const hasResults = totalResults > 0;
	const hasBody = !hasResults && bodyText.trim().length > 0;

	function CompleteTracker({
		step,
	}: {
		step: Extract<TimelineStep, { type: "tool-call" }>;
	}) {
		useToolComplete(stepStates[step.id] === "animating", step.duration, () =>
			onStepComplete(step.id)
		);
		return null;
	}

	const items = useMemo(
		() => [
			{
				id: toolSteps.map((s) => s.id).join("-") || "search",
				type: "search" as const,
				query: searchQuery,
				results: hasResults
					? results.map((r, i) => ({
							id: `${r.title}-${i}`,
							title: r.title,
							domain: r.date || String(r.source),
						}))
					: undefined,
				moreCount: undefined,
			},
			...(hasBody
				? [
						{
							id: "search-body",
							type: "text" as const,
							content: bodyText,
						},
					]
				: []),
		],
		[toolSteps, searchQuery, hasResults, results, hasBody, bodyText]
	);

	return (
		<>
			{toolSteps.map((step) => (
				<CompleteTracker key={step.id} step={step} />
			))}
			<AgentActivity
				activeLabel="Searching the web…"
				collapseOnComplete={false}
				contentType="search"
				defaultOpen={defaultOpen}
				items={items}
				status={anyAnimating ? "working" : "complete"}
				summary={searchCompleteLabel(totalResults, hasBody)}
			/>
		</>
	);
}

export interface SearchToolProps {
	defaultOpen?: boolean;
	part: {
		id?: string;
		toolCallId?: string;
		type?: string;
		state?: string;
		input?: Record<string, unknown>;
		args?: Record<string, unknown>;
		output?: Record<string, unknown>;
		result?: Record<string, unknown>;
	};
	results?: SearchResult[];
}

// Markdown link: `[title](https://…)`. Declared at module scope so it isn't
// rebuilt per render; consumed via `matchAll`, which uses its own iterator.
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const WWW_PREFIX_RE = /^www\./;

/**
 * Unwrap the payload shapes WebSearch actually arrives in: Core's
 * `{ status, output }` envelope, ACP content-block arrays (`[{type,text}]`),
 * and plain strings — flattening them all to human-readable text.
 */
function toOutputText(value: unknown): string {
	if (value == null) {
		return "";
	}
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(toOutputText).filter(Boolean).join("\n");
	}
	if (typeof value === "object") {
		const obj = value as Record<string, unknown>;
		if (typeof obj.text === "string") {
			return obj.text;
		}
		if (obj.output !== undefined) {
			return toOutputText(obj.output);
		}
		if (obj.content !== undefined) {
			return toOutputText(obj.content);
		}
		if (typeof obj.result === "string") {
			return obj.result;
		}
	}
	return "";
}

/** Pull `[title](url)` markdown links out of result prose as titled results. */
function parseLinkResults(text: string): SearchResult[] {
	const out: SearchResult[] = [];
	const seen = new Set<string>();
	for (const match of text.matchAll(MD_LINK_RE)) {
		const title = match[1]?.trim();
		const url = match[2]?.trim();
		if (!(title && url) || seen.has(url)) {
			continue;
		}
		seen.add(url);
		let host = url;
		try {
			host = new URL(url).hostname.replace(WWW_PREFIX_RE, "");
		} catch {
			// Leave `host` as the raw URL if it doesn't parse.
		}
		out.push({ title, source: host as SourceType, date: "" });
	}
	return out;
}

function normalizeResults(value: unknown): SearchResult[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const parsed = value
		.map((item) => {
			if (!item || typeof item !== "object") {
				return null;
			}
			const source = (item as { source?: unknown }).source;
			const title = (item as { title?: unknown }).title;
			const date = (item as { date?: unknown }).date;
			// title is required; source and date are optional (ACP results may omit them)
			if (typeof title !== "string") {
				return null;
			}
			return {
				source: (typeof source === "string" ? source : "") as SourceType,
				title,
				date: typeof date === "string" ? date : "",
			};
		})
		.filter((item): item is SearchResult => Boolean(item));
	return parsed.length > 0 ? parsed : undefined;
}

export const SearchTool = memo(function SearchTool({
	part,
	results,
	defaultOpen,
}: SearchToolProps) {
	const step = mapToolInvocationToStep(part.toolCallId ?? part.id ?? "search", {
		toolName: part.type?.replace("tool-", "") || "WebSearch",
		args: part.input ?? part.args ?? {},
		state:
			part.state === "output-available"
				? "result"
				: part.state === "input-streaming"
					? "partial-call"
					: "call",
		result: part.output ?? part.result,
	});
	const stepState = mapToolStateToStepState(
		part.state === "output-available"
			? "result"
			: part.state === "input-streaming"
				? "partial-call"
				: "call"
	);
	const stepStates = { [step.id]: stepState };
	const noop = () => {};

	// Prefer a structured, titled result list when one is present (mock/native or
	// an agent's raw_output). Otherwise fall back to the prose the tool returned:
	// unwrap the real payload to text and lift any markdown links into results,
	// keeping whatever remains as the panel body. This is what fixes the old
	// "Found 0 results" for ACP WebSearch, whose output is text, not `{results}`.
	const structured =
		results ??
		normalizeResults(part.output?.results) ??
		normalizeResults(part.result?.results) ??
		normalizeResults(
			(part.output as { output?: { results?: unknown } })?.output?.results
		) ??
		normalizeResults(
			(part.result as { output?: { results?: unknown } })?.output?.results
		);
	const bodyText = structured ? "" : toOutputText(part.output ?? part.result);
	const linked = structured ?? (bodyText ? parseLinkResults(bodyText) : []);

	return (
		<SearchGroupRich
			bodyText={bodyText}
			defaultOpen={defaultOpen}
			onStepComplete={noop}
			results={linked}
			stepStates={stepStates}
			toolSteps={[step]}
		/>
	);
});
