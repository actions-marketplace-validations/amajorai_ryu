import type { AgentSummary } from "@ryuhq/core-client/agents";

export interface SlashCommandSuggestion {
	readonly description: string;
	readonly kind: "command";
	readonly name: string;
}

export interface AgentSuggestion {
	readonly id: string;
	readonly kind: "agent";
	readonly name: string;
}

export type AutocompleteSuggestion = SlashCommandSuggestion | AgentSuggestion;

export interface AutocompleteContext {
	readonly kind: "slash" | "mention";
	readonly query: string;
	readonly start: number;
}

export interface AutocompleteState {
	readonly context: AutocompleteContext;
	readonly index: number;
	readonly suggestions: AutocompleteSuggestion[];
}

const MAX_SUGGESTIONS = 8;

/** Commands handled locally by the chat composer, including aliases. */
export const LOCAL_SLASH_COMMANDS: SlashCommandSuggestion[] = [
	{ kind: "command", name: "agent", description: "choose an agent" },
	{ kind: "command", name: "btw", description: "ask a side question" },
	{ kind: "command", name: "check", description: "toggle double-check" },
	{ kind: "command", name: "config", description: "choose ACP settings" },
	{ kind: "command", name: "fork", description: "fork this conversation" },
	{ kind: "command", name: "model", description: "choose or set a model" },
	{ kind: "command", name: "new", description: "start a new chat" },
	{ kind: "command", name: "reasoning", description: "choose ACP settings" },
	{ kind: "command", name: "resume", description: "resume a conversation" },
	{ kind: "command", name: "rename", description: "rename this conversation" },
	{ kind: "command", name: "delete", description: "delete a conversation" },
	{ kind: "command", name: "sessions", description: "list turn sessions" },
	{ kind: "command", name: "team", description: "route turns to a team" },
	{ kind: "command", name: "goal", description: "send a goal turn" },
	{ kind: "command", name: "proof", description: "send a proof turn" },
	{ kind: "command", name: "receipt", description: "send a receipt turn" },
];

/** Return a completion context only when the token at the cursor is completeable. */
export function getAutocompleteContext(
	value: string
): AutocompleteContext | null {
	const slash = value.match(/^\s*\/([\w-]*)$/);
	if (slash) {
		return {
			kind: "slash",
			query: slash[1] ?? "",
			start: value.length - slash[0].length + slash[0].indexOf("/"),
		};
	}
	const mention = value.match(/(?:^|\s)@([\w.-]*)$/);
	if (mention) {
		return {
			kind: "mention",
			query: mention[1] ?? "",
			start: value.length - (mention[1]?.length ?? 0) - 1,
		};
	}
	return null;
}

export function commandSuggestions(query: string): SlashCommandSuggestion[] {
	const normalized = query.toLowerCase();
	return LOCAL_SLASH_COMMANDS.filter((command) =>
		command.name.startsWith(normalized)
	).slice(0, MAX_SUGGESTIONS);
}

export function agentSuggestions(
	agents: AgentSummary[],
	query: string
): AgentSuggestion[] {
	const normalized = query.toLowerCase();
	return agents
		.filter(
			(agent) =>
				agent.id.toLowerCase().includes(normalized) ||
				agent.name.toLowerCase().includes(normalized)
		)
		.map((agent) => ({
			kind: "agent" as const,
			id: agent.id,
			name: agent.name,
		}))
		.slice(0, MAX_SUGGESTIONS);
}

export function moveAutocompleteIndex(
	index: number,
	delta: -1 | 1,
	length: number
): number {
	if (length === 0) {
		return 0;
	}
	return Math.max(0, Math.min(length - 1, index + delta));
}

/** Replace only the active token, preserving any text before it. */
export function applyAutocomplete(
	value: string,
	context: AutocompleteContext,
	suggestion: AutocompleteSuggestion
): string {
	const replacement =
		suggestion.kind === "command"
			? `/${suggestion.name} `
			: `@${suggestion.id} `;
	return `${value.slice(0, context.start)}${replacement}`;
}
