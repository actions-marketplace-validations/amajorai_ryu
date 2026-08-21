import {
	ComposerMenu,
	type ComposerMenuGroup,
} from "@ryu/blocks/desktop/agent-elements/input/composer-menu.tsx";
import { useMemo } from "react";

export interface SlashCommand {
	body?: string;
	description: string;
	hint?: string | null;
	name: string;
	source: "agent" | "local" | "plugin" | "user";
}

interface SlashCommandAutocompleteProps {
	anchorRef: React.RefObject<HTMLElement | null>;
	commands: SlashCommand[];
	onDismiss: () => void;
	onSelect: (command: SlashCommand) => void;
	query: string;
}

/** The / trigger expressed through the same list surface as + and @. */
export function SlashCommandAutocomplete({
	commands,
	query,
	onSelect,
	onDismiss,
	anchorRef,
}: SlashCommandAutocompleteProps) {
	const byId = useMemo(
		() => new Map(commands.map((command) => [command.name, command])),
		[commands]
	);
	const groups = useMemo<ComposerMenuGroup[]>(
		() => [
			{
				id: "commands",
				label: "Commands",
				items: commands.map((command) => ({
					id: command.name,
					label: `/${command.name}`,
					description: command.description,
					keywords: [command.name, command.hint ?? ""],
					badge:
						command.source === "local"
							? "Ryu"
							: command.source === "plugin"
								? "Plugin"
								: undefined,
				})),
			},
		],
		[commands]
	);

	return (
		<ComposerMenu
			anchorRef={anchorRef}
			className="absolute bottom-full left-0 z-50 mb-2"
			groups={groups}
			onDismiss={onDismiss}
			onSelect={(item) => {
				const command = byId.get(item.id);
				if (command) {
					onSelect(command);
				}
			}}
			query={query}
		/>
	);
}
