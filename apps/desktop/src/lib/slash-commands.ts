/**
 * Shared slash-command data and the pure functions that drive the composer's
 * command/argument menu.
 *
 * Plugin contributions arrive as JSON, so this file is also the boundary where
 * the desktop turns unknown records into the small typed model the UI trusts.
 */

export type SlashCommandSource =
	| "agent"
	| "local"
	| "plugin"
	| "skill"
	| "user";

export interface SlashCommandOption {
	description?: string;
	label: string;
	value: string;
}

export interface SlashCommandCustomOption {
	description?: string;
	label: string;
}

export interface SlashCommandArgument {
	custom?: SlashCommandCustomOption;
	description?: string;
	name: string;
	options: SlashCommandOption[];
}

export interface SlashCommand {
	args: SlashCommandArgument[];
	body?: string;
	description: string;
	hint?: string | null;
	name: string;
	source: SlashCommandSource;
}

export interface SlashSkill {
	description: string | null;
	enabled: boolean;
	id: string;
	name: string;
}

export interface SlashCommandOptionSelection {
	kind: "custom" | "registered";
	option: SlashCommandOption;
}

/** Merge enabled installed skills after commands, preserving command precedence. */
export function mergeComposerCommands(
	base: readonly SlashCommand[],
	skills: readonly SlashSkill[]
): SlashCommand[] {
	const merged = [...base];
	const seen = new Set(
		base.map((command) => command.name.trim().toLowerCase())
	);
	for (const skill of skills) {
		if (!skill.enabled) {
			continue;
		}
		const name = skill.id.trim().replace(/^\/+/, "");
		if (!name || /\s/.test(name)) {
			continue;
		}
		const key = name.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		merged.push({
			args: [],
			description: skill.description?.trim() ?? "",
			hint: skill.name.trim() || name,
			name,
			source: "skill",
		});
	}
	return merged;
}

export type SlashCommandMenuState =
	| { kind: "commands"; query: string }
	| {
			argument: SlashCommandArgument;
			argumentIndex: number;
			command: SlashCommand;
			kind: "arguments";
			query: string;
	  };

function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	return Object.fromEntries(Object.entries(value));
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOption(value: unknown): SlashCommandOption | null {
	if (typeof value === "string" && value.trim()) {
		const option = value.trim();
		return { label: option, value: option };
	}
	const record = asRecord(value);
	if (!record) {
		return null;
	}
	const optionValue = nonEmptyString(record.value ?? record.id ?? record.name);
	if (!optionValue) {
		return null;
	}
	return {
		description: nonEmptyString(record.description) ?? undefined,
		label:
			nonEmptyString(record.label ?? record.name ?? record.value) ??
			optionValue,
		value: optionValue,
	};
}

function readCustomOption(
	value: unknown
): SlashCommandCustomOption | undefined {
	if (value === true || value === "true") {
		return {
			description: "Type a value that is not in the registered options.",
			label: "Use a custom value",
		};
	}
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}
	return {
		description:
			nonEmptyString(record.description) ??
			"Type a value that is not in the registered options.",
		label: nonEmptyString(record.label) ?? "Use a custom value",
	};
}

function readArgument(
	value: unknown,
	index: number
): SlashCommandArgument | null {
	const record = asRecord(value);
	if (!record) {
		return null;
	}
	const optionsValue = record.options ?? record.choices ?? record.values;
	const options = Array.isArray(optionsValue)
		? optionsValue.flatMap((option) => {
				const parsed = readOption(option);
				return parsed ? [parsed] : [];
			})
		: [];
	const custom = readCustomOption(
		record.custom ?? record.allow_custom ?? record.allowCustom
	);
	return {
		custom,
		description: nonEmptyString(record.description) ?? undefined,
		name:
			nonEmptyString(record.name ?? record.label ?? record.id) ??
			`Argument ${index + 1}`,
		options,
	};
}

function readArguments(value: unknown): SlashCommandArgument[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((argument, index) => {
		const parsed = readArgument(argument, index);
		return parsed ? [parsed] : [];
	});
}

/** Parse one plugin/app contribution at the untrusted API boundary. */
export function parseSlashCommandContribution(
	value: unknown
): SlashCommand | null {
	const record = asRecord(value);
	if (!record) {
		return null;
	}
	const command = nonEmptyString(record.command);
	if (!command) {
		return null;
	}
	const name = command.replace(/^\//, "").trim();
	if (!name || /\s/.test(name)) {
		return null;
	}
	const body = nonEmptyString(record.body) ?? undefined;
	return {
		args: readArguments(record.args ?? record.parameters),
		body,
		description: nonEmptyString(record.description) ?? "",
		hint: nonEmptyString(record.hint),
		name,
		source: body ? "user" : "plugin",
	};
}

function findCommand(
	commands: readonly SlashCommand[],
	name: string
): SlashCommand | undefined {
	const normalized = name.toLowerCase();
	return commands.find((command) => command.name.toLowerCase() === normalized);
}

/**
 * Resolve the menu that belongs to the current slash-command fragment.
 *
 * A command fragment (`/calendar`) opens the command list. Once the command is
 * known, each completed whitespace-delimited argument advances to the next
 * registered parameter and the current token becomes that menu's filter.
 */
export function parseSlashMenuState(
	value: string,
	commands: readonly SlashCommand[]
): SlashCommandMenuState | null {
	const match = /^\/(\S*)(?:\s+([\s\S]*))?$/.exec(value);
	if (!match) {
		return null;
	}
	const name = match[1] ?? "";
	const command = findCommand(commands, name);
	const argumentText = match[2];
	if (argumentText === undefined) {
		return { kind: "commands", query: name };
	}
	if (!command) {
		return null;
	}
	const hasTrailingWhitespace = /\s$/.test(argumentText);
	const tokens = argumentText.trim() ? argumentText.trim().split(/\s+/) : [];
	const argumentIndex = hasTrailingWhitespace
		? tokens.length
		: Math.max(tokens.length - 1, 0);
	const argument = command.args[argumentIndex];
	if (!argument) {
		return null;
	}
	const query = hasTrailingWhitespace ? "" : (tokens.at(-1) ?? "");
	const pickedLastRegisteredOption =
		!hasTrailingWhitespace &&
		argumentIndex === command.args.length - 1 &&
		argument.options.some((option) => option.value === query);
	if (pickedLastRegisteredOption) {
		return null;
	}
	return {
		argument,
		argumentIndex,
		command,
		kind: "arguments",
		query,
	};
}

/** Replace the current argument token and leave the cursor at the next slot. */
export function applySlashCommandOption(
	value: string,
	optionValue: string,
	hasNextArgument: boolean
): string {
	const prefix = value.replace(/\S*$/, "");
	const next = `${prefix}${optionValue}`;
	return hasNextArgument ? `${next} ` : next;
}
