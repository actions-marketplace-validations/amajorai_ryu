import {
	ComposerMenu,
	type ComposerMenuGroup,
} from "@ryu/blocks/desktop/agent-elements/input/composer-menu.tsx";
import { createElement, useMemo } from "react";
import type { MentionGroup, MentionItem } from "@/src/lib/mentions/types.ts";

interface MentionMenuProps {
	anchorRef: React.RefObject<HTMLTextAreaElement | null>;
	groups: MentionGroup[];
	onDismiss: () => void;
	onSelect: (item: MentionItem) => void;
}

/** The @ trigger expressed through the same list surface as + and /. */
export function MentionMenu({
	groups,
	onSelect,
	onDismiss,
	anchorRef,
}: MentionMenuProps) {
	const byId = useMemo<Map<string, MentionItem>>(
		() =>
			new Map(
				groups.flatMap((group) =>
					group.items.map((item) => [`${item.kind}:${item.id}`, item] as const)
				)
			),
		[groups]
	);
	const menuGroups = useMemo<ComposerMenuGroup[]>(
		() =>
			groups.map((group) => ({
				id: group.kind,
				label: group.label,
				items: group.items.map((item) => ({
					id: `${item.kind}:${item.id}`,
					label: item.label,
					description: item.description,
					badge:
						item.kind === "plugin"
							? "Plugin"
							: item.kind === "app"
								? "App"
								: undefined,
					icon: item.icon
						? createElement(item.icon, { className: "size-4" })
						: undefined,
				})),
			})),
		[groups]
	);

	return (
		<ComposerMenu
			anchorRef={anchorRef}
			className="absolute bottom-full left-0 z-50 mb-2"
			groups={menuGroups}
			onDismiss={onDismiss}
			onSelect={(item) => {
				const mention = byId.get(item.id);
				if (mention) {
					onSelect(mention);
				}
			}}
		/>
	);
}
