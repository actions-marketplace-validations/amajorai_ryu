import type {
	ComposerMenuGroup,
	ComposerMenuItem,
} from "../desktop/agent-elements/input/composer-menu.tsx";
import type { MentionItem } from "../desktop/agent-elements/types.ts";
import type { ComposerSettingsSection } from "./composer-settings-menu.tsx";

/** The shared directory data used by the composer menu and inline mentions. */
export interface ComposerDirectory {
	groups: ComposerMenuGroup[];
	mentionItems: MentionItem[];
	onSelect: (item: ComposerMenuItem) => void;
}

/**
 * Project the settings sections a surface already owns into the same searchable
 * directory used by `+` and `@`. Keeping the projection here means a new chat
 * surface cannot grow a private menu or mention-token data shape.
 */
export function createComposerDirectory(
	sections: readonly ComposerSettingsSection[]
): ComposerDirectory {
	const selectionHandlers = new Map<string, () => void>();
	const groups: ComposerMenuGroup[] = [];
	const mentionItems: MentionItem[] = [];

	for (const section of sections) {
		if (section.items.length === 0) {
			continue;
		}

		const items: ComposerMenuItem[] = [];
		for (const item of section.items) {
			const id = `settings:${section.key}:${item.id}`;
			items.push({
				description: item.description ?? undefined,
				id,
				keywords: [section.key, section.label, item.name],
				label: item.name,
			});
			mentionItems.push({
				id,
				kind: section.key,
				label: item.name,
			});
			selectionHandlers.set(id, () => section.onChange(item.id));
		}
		groups.push({ id: `settings:${section.key}`, items, label: section.label });
	}

	return {
		groups,
		mentionItems,
		onSelect: (item) => selectionHandlers.get(item.id)?.(),
	};
}
