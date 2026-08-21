/**
 * Pure slash-command registry for the terminal chat surface.
 *
 * The registry deliberately stops at data and intent. React surfaces decide how
 * to fulfil a local action or render an overlay; pass-through commands return
 * their original slash text so Core remains the owner of those turn hooks.
 */

export type CommandExecutionMode = "local" | "overlay" | "passthrough";

/** Commands offered by the built-in terminal composer. */
export type CommandName =
	| "agent"
	| "btw"
	| "check"
	| "config"
	| "fork"
	| "model"
	| "new"
	| "reasoning"
	| "resume"
	| "rename"
	| "delete"
	| "sessions"
	| "team"
	| "goal"
	| "proof"
	| "receipt"
	| "pin"
	| "unpin"
	| "help"
	| "queue"
	| "theme";

/** The completion surface a command is eligible for. */
export type CommandCompletionKind = "command" | "none";

export type CommandOverlay =
	| "agent-picker"
	| "acp-settings"
	| "btw"
	| "conversation-delete"
	| "help"
	| "model-picker"
	| "queue"
	| "session-list"
	| "theme";

export type LocalCommandAction =
	| { readonly action: "new-chat"; readonly kind: "local" }
	| { readonly action: "toggle-double-check"; readonly kind: "local" }
	| {
			readonly action: "set-model";
			readonly kind: "local";
			readonly model: string | null;
	  }
	| {
			readonly action: "set-team";
			readonly kind: "local";
			readonly team: string | null;
	  }
	| {
			readonly action: "fork-conversation";
			readonly kind: "local";
			readonly messageId: string | null;
	  }
	| {
			readonly action: "resume-conversation";
			readonly conversationId: string;
			readonly kind: "local";
	  }
	| {
			readonly action: "rename-conversation";
			readonly kind: "local";
			readonly title: string;
	  }
	| {
			readonly action: "pin-conversation";
			readonly kind: "local";
			readonly pinned: boolean;
	  }
	| { readonly action: "clear-queue"; readonly kind: "local" }
	| {
			readonly action: "remove-queue-item";
			readonly itemId: string;
			readonly kind: "local";
	  }
	| {
			readonly action: "move-queue-item";
			readonly direction: "up" | "down";
			readonly itemId: string;
			readonly kind: "local";
	  };

export interface OverlayCommandAction {
	readonly args: readonly string[];
	readonly argument: string;
	readonly kind: "overlay";
	readonly overlay: CommandOverlay;
}

export interface PassthroughCommandAction {
	readonly args: readonly string[];
	readonly kind: "passthrough";
	readonly text: string;
}

export type CommandAction =
	| LocalCommandAction
	| OverlayCommandAction
	| PassthroughCommandAction;

export interface CommandHandlerContext {
	readonly args: readonly string[];
	readonly argument: string;
	/** The token the user typed, without the leading slash. */
	readonly invokedAs: string;
	/** The trimmed slash command, retained for Core pass-through. */
	readonly raw: string;
	/** The canonical spec selected after alias resolution. */
	readonly spec: CommandSpec;
}

export type CommandHandlerResult =
	| { readonly action: CommandAction; readonly kind: "action" }
	| { readonly kind: "usage"; readonly message: string };

export type CommandHandler = (
	context: CommandHandlerContext
) => CommandHandlerResult;

export interface CommandSpec {
	/** Alternate spellings accepted by {@link resolveCommand}. */
	readonly aliases: readonly string[];
	readonly completion: CommandCompletionKind;
	readonly description: string;
	/** Pure conversion from parsed input to a data-only intent. */
	readonly handler: CommandHandler;
	/** Default surface intent; a handler may open a picker for optional input. */
	readonly mode: CommandExecutionMode;
	/** Stable name used in help, completion rows, and dispatch results. */
	readonly name: CommandName;
	readonly usage: string;
}

export interface ParsedCommand {
	readonly args: readonly string[];
	readonly argument: string;
	/** Canonical command name when the token is known. */
	readonly canonicalName: CommandName | undefined;
	/** Name or alias as entered, normalized to lower case. */
	readonly invokedAs: string;
	/** Trimmed source text, including the leading slash. */
	readonly raw: string;
	/** The resolved spec, or undefined for an unknown command. */
	readonly spec: CommandSpec | undefined;
}

export type CommandDispatch =
	| {
			readonly action: CommandAction;
			readonly args: readonly string[];
			readonly canonicalName: CommandName;
			readonly invokedAs: string;
			readonly kind: "handled";
			readonly mode: CommandExecutionMode;
			readonly spec: CommandSpec;
	  }
	| {
			readonly args: readonly string[];
			readonly canonicalName: CommandName;
			readonly invokedAs: string;
			readonly kind: "usage";
			readonly message: string;
			readonly spec: CommandSpec;
			readonly usage: string;
	  }
	| {
			readonly invokedAs: string;
			readonly kind: "unknown";
			readonly message: string;
			readonly raw: string;
	  };

const WHITESPACE = /\s+/;
const COMMAND_INPUT = /^\s*\/([\w-]+)(?:\s+([\s\S]*?))?\s*$/;

const action = (value: CommandAction): CommandHandlerResult => ({
	action: value,
	kind: "action",
});

const usage = (context: CommandHandlerContext): CommandHandlerResult => ({
	kind: "usage",
	message: `Usage: ${context.spec.usage}`,
});

const requireNoArguments = (
	context: CommandHandlerContext,
	value: LocalCommandAction | OverlayCommandAction
): CommandHandlerResult =>
	context.args.length === 0 ? action(value) : usage(context);

const requireArgument = (
	context: CommandHandlerContext,
	value: (argument: string) => CommandAction
): CommandHandlerResult =>
	context.argument.length > 0
		? action(value(context.argument))
		: usage(context);

const requireOneArgument = (
	context: CommandHandlerContext,
	value: (argument: string) => CommandAction
): CommandHandlerResult =>
	context.args.length === 1 && context.argument.length > 0
		? action(value(context.argument))
		: usage(context);

const optionalOneArgument = (
	context: CommandHandlerContext,
	value: (argument: string | null) => CommandAction
): CommandHandlerResult =>
	context.args.length <= 1
		? action(value(context.argument.length > 0 ? context.argument : null))
		: usage(context);

const local = (value: LocalCommandAction): CommandHandlerResult =>
	action(value);

const overlay = (
	context: CommandHandlerContext,
	name: CommandOverlay
): CommandHandlerResult =>
	action({
		argument: context.argument,
		args: context.args,
		kind: "overlay",
		overlay: name,
	});

const noArgumentOverlay =
	(name: CommandOverlay): CommandHandler =>
	(context) =>
		requireNoArguments(context, {
			argument: "",
			args: [],
			kind: "overlay",
			overlay: name,
		});

const requiredPassThrough = (
	context: CommandHandlerContext
): CommandHandlerResult =>
	context.argument.length > 0
		? action({
				args: context.args,
				kind: "passthrough",
				text: context.raw,
			})
		: usage(context);

const queueCommand: CommandHandler = (context) => {
	const [subcommand, itemId, extra] = context.args;
	if (!subcommand || subcommand === "list" || subcommand === "show") {
		return context.args.length <= 1
			? overlay(context, "queue")
			: usage(context);
	}
	if (subcommand === "clear") {
		return context.args.length === 1
			? local({ action: "clear-queue", kind: "local" })
			: usage(context);
	}
	if (subcommand === "drop" || subcommand === "remove") {
		return itemId && !extra
			? local({ action: "remove-queue-item", itemId, kind: "local" })
			: usage(context);
	}
	if (subcommand === "up" || subcommand === "down") {
		return itemId && !extra
			? local({
					action: "move-queue-item",
					direction: subcommand === "up" ? "up" : "down",
					itemId,
					kind: "local",
				})
			: usage(context);
	}
	return usage(context);
};

/**
 * The one source of built-in terminal command metadata and pure handlers.
 * Keep canonical command order stable: autocomplete has always exposed the
 * first eight commands in this order when the query is empty.
 */
export const COMMAND_SPECS = [
	{
		name: "agent",
		aliases: [],
		description: "choose an agent",
		usage: "/agent",
		completion: "command",
		mode: "overlay",
		handler: noArgumentOverlay("agent-picker"),
	},
	{
		name: "btw",
		aliases: ["b"],
		description: "ask a side question",
		usage: "/btw <question>",
		completion: "command",
		mode: "overlay",
		handler: (context) =>
			requireArgument(context, () => ({
				argument: context.argument,
				args: context.args,
				kind: "overlay",
				overlay: "btw",
			})),
	},
	{
		name: "check",
		aliases: ["double-check"],
		description: "toggle double-check",
		usage: "/check",
		completion: "command",
		mode: "local",
		handler: (context) =>
			requireNoArguments(context, {
				action: "toggle-double-check",
				kind: "local",
			}),
	},
	{
		name: "config",
		aliases: ["acp"],
		description: "choose ACP settings",
		usage: "/config",
		completion: "command",
		mode: "overlay",
		handler: noArgumentOverlay("acp-settings"),
	},
	{
		name: "fork",
		aliases: [],
		description: "fork this conversation",
		usage: "/fork [message-id]",
		completion: "command",
		mode: "local",
		handler: (context) =>
			optionalOneArgument(context, (messageId) => ({
				action: "fork-conversation",
				kind: "local",
				messageId,
			})),
	},
	{
		name: "model",
		aliases: [],
		description: "choose or set a model",
		usage: "/model [id|clear]",
		completion: "command",
		mode: "overlay",
		handler: (context) => {
			if (context.args.length === 0) {
				return overlay(context, "model-picker");
			}
			if (context.argument.toLowerCase() === "clear") {
				return context.args.length === 1
					? local({ action: "set-model", kind: "local", model: null })
					: usage(context);
			}
			return local({
				action: "set-model",
				kind: "local",
				model: context.argument,
			});
		},
	},
	{
		name: "new",
		aliases: ["newchat"],
		description: "start a new chat",
		usage: "/new",
		completion: "command",
		mode: "local",
		handler: (context) =>
			requireNoArguments(context, { action: "new-chat", kind: "local" }),
	},
	{
		name: "reasoning",
		aliases: [],
		description: "choose ACP settings",
		usage: "/reasoning",
		completion: "command",
		mode: "overlay",
		handler: noArgumentOverlay("acp-settings"),
	},
	{
		name: "resume",
		aliases: [],
		description: "resume a conversation",
		usage: "/resume <conversation-id>",
		completion: "command",
		mode: "local",
		handler: (context) =>
			requireOneArgument(context, (conversationId) => ({
				action: "resume-conversation",
				conversationId,
				kind: "local",
			})),
	},
	{
		name: "rename",
		aliases: [],
		description: "rename this conversation",
		usage: "/rename <title>",
		completion: "command",
		mode: "local",
		handler: (context) =>
			requireArgument(context, (title) => ({
				action: "rename-conversation",
				kind: "local",
				title,
			})),
	},
	{
		name: "delete",
		aliases: [],
		description: "delete a conversation",
		usage: "/delete [conversation-id]",
		completion: "command",
		mode: "overlay",
		handler: (context) =>
			optionalOneArgument(context, (conversationId) => ({
				argument: conversationId ?? "",
				args: conversationId ? [conversationId] : [],
				kind: "overlay",
				overlay: "conversation-delete",
			})),
	},
	{
		name: "sessions",
		aliases: ["session"],
		description: "list turn sessions",
		usage: "/sessions",
		completion: "command",
		mode: "overlay",
		handler: noArgumentOverlay("session-list"),
	},
	{
		name: "team",
		aliases: [],
		description: "route turns to a team",
		usage: "/team [team-id|clear]",
		completion: "command",
		mode: "local",
		handler: (context) =>
			optionalOneArgument(context, (team) => ({
				action: "set-team",
				kind: "local",
				team: !team || team.toLowerCase() === "clear" ? null : team,
			})),
	},
	{
		name: "goal",
		aliases: [],
		description: "send a goal turn",
		usage: "/goal <text>",
		completion: "command",
		mode: "passthrough",
		handler: requiredPassThrough,
	},
	{
		name: "proof",
		aliases: [],
		description: "send a proof turn",
		usage: "/proof <text>",
		completion: "command",
		mode: "passthrough",
		handler: requiredPassThrough,
	},
	{
		name: "receipt",
		aliases: [],
		description: "send a receipt turn",
		usage: "/receipt <text>",
		completion: "command",
		mode: "passthrough",
		handler: requiredPassThrough,
	},
	{
		name: "pin",
		aliases: [],
		description: "pin or unpin this conversation",
		usage: "/pin [off]",
		completion: "command",
		mode: "local",
		handler: (context) =>
			optionalOneArgument(context, (value) => ({
				action: "pin-conversation",
				kind: "local",
				pinned:
					value?.toLowerCase() !== "off" && value?.toLowerCase() !== "false",
			})),
	},
	{
		name: "unpin",
		aliases: [],
		description: "unpin this conversation",
		usage: "/unpin",
		completion: "command",
		mode: "local",
		handler: (context) =>
			requireNoArguments(context, {
				action: "pin-conversation",
				kind: "local",
				pinned: false,
			}),
	},
	{
		name: "help",
		aliases: ["commands"],
		description: "show slash command help",
		usage: "/help [command]",
		completion: "command",
		mode: "overlay",
		handler: (context) =>
			optionalOneArgument(context, () => ({
				argument: context.argument,
				args: context.args,
				kind: "overlay",
				overlay: "help",
			})),
	},
	{
		name: "queue",
		aliases: ["q"],
		description: "inspect or change queued prompts",
		usage: "/queue [list|clear|drop <id>|up <id>|down <id>]",
		completion: "command",
		mode: "overlay",
		handler: queueCommand,
	},
	{
		name: "theme",
		aliases: [],
		description: "choose the terminal theme",
		usage: "/theme [mode|preset]",
		completion: "command",
		mode: "overlay",
		handler: (context) => overlay(context, "theme"),
	},
] as const satisfies readonly CommandSpec[];

/** Alias kept explicit so consumers can name the source as a registry. */
export const COMMAND_REGISTRY = COMMAND_SPECS;

function normalizeCommandToken(value: string): string {
	const token = value.trim().toLowerCase();
	return token.startsWith("/") ? token.slice(1) : token;
}

/** Resolve a canonical command or alias. Leading slash and case are optional. */
export function resolveCommand(name: string): CommandSpec | undefined {
	const normalized = normalizeCommandToken(name);
	if (normalized.length === 0) {
		return undefined;
	}
	return COMMAND_SPECS.find(
		(spec) =>
			spec.name === normalized ||
			(spec.aliases as readonly string[]).includes(normalized)
	);
}

/** Parse a complete slash command, preserving unknown commands for warnings. */
export function parseCommand(value: string): ParsedCommand | null {
	const match = COMMAND_INPUT.exec(value);
	if (!match) {
		return null;
	}
	const invokedAs = (match[1] ?? "").toLowerCase();
	const argument = (match[2] ?? "").trim();
	const spec = resolveCommand(invokedAs);
	return {
		args: argument.length > 0 ? argument.split(WHITESPACE) : [],
		argument,
		canonicalName: spec?.name,
		invokedAs,
		raw: value.trim(),
		spec,
	};
}

/** Convert a complete slash command into a pure local/overlay/pass-through intent. */
export function dispatchCommand(value: string): CommandDispatch | null {
	const parsed = parseCommand(value);
	if (!parsed) {
		return null;
	}
	if (!parsed.spec) {
		return {
			invokedAs: parsed.invokedAs,
			kind: "unknown",
			message: `Unknown command: /${parsed.invokedAs}`,
			raw: parsed.raw,
		};
	}

	const result = parsed.spec.handler({
		argument: parsed.argument,
		args: parsed.args,
		invokedAs: parsed.invokedAs,
		raw: parsed.raw,
		spec: parsed.spec,
	});
	if (result.kind === "usage") {
		return {
			args: parsed.args,
			canonicalName: parsed.spec.name,
			invokedAs: parsed.invokedAs,
			kind: "usage",
			message: result.message,
			spec: parsed.spec,
			usage: parsed.spec.usage,
		};
	}
	return {
		action: result.action,
		args: parsed.args,
		canonicalName: parsed.spec.name,
		invokedAs: parsed.invokedAs,
		kind: "handled",
		mode: result.action.kind,
		spec: parsed.spec,
	};
}

/** Specs eligible for slash completion, matching canonical names and aliases. */
export function commandCompletions(query: string): CommandSpec[] {
	const normalized = query.trim().toLowerCase();
	return COMMAND_SPECS.filter(
		(spec) =>
			spec.completion === "command" &&
			(spec.name.startsWith(normalized) ||
				spec.aliases.some((alias) => alias.startsWith(normalized)))
	);
}

export interface CommandHelpRow {
	readonly aliases: readonly string[];
	readonly description: string;
	readonly mode: CommandExecutionMode;
	readonly name: CommandName;
	readonly usage: string;
}

/** Stable help rows derived from the registry. */
export function commandHelpRows(): CommandHelpRow[] {
	return COMMAND_SPECS.map(({ aliases, description, mode, name, usage }) => ({
		aliases,
		description,
		mode,
		name,
		usage,
	}));
}

/** Render the terminal slash-command help without depending on a UI component. */
export function renderCommandHelp(): string {
	const rows = commandHelpRows();
	const labels = rows.map((row) =>
		row.aliases.length > 0
			? `${row.usage} (${row.aliases.map((alias) => `/${alias}`).join(", ")})`
			: row.usage
	);
	const width = Math.max(...labels.map((label) => label.length));
	return [
		"Slash commands:",
		...rows.map(
			(row, index) =>
				`  ${labels[index]?.padEnd(width) ?? row.usage}  ${row.description}`
		),
	].join("\n");
}
