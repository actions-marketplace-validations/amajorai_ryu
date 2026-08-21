import type { AgentSummary } from "@ryuhq/core-client/agents";
import { commandCompletions } from "./commands.ts";

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

/**
 * Compatibility view for existing chat surfaces. The registry owns command
 * metadata; aliases influence matching but do not create duplicate rows.
 */
export const LOCAL_SLASH_COMMANDS: SlashCommandSuggestion[] =
	commandCompletions("").map(({ description, name }) => ({
		description,
		kind: "command" as const,
		name,
	}));

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
	return commandCompletions(query)
		.map(({ description, name }) => ({
			description,
			kind: "command" as const,
			name,
		}))
		.slice(0, MAX_SUGGESTIONS);
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
