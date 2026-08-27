export interface SelectedHumanMention {
	id: string;
	label: string;
}

export function selectHumanNotificationTargets({
	content,
	currentUserId,
	selected,
}: {
	content: string;
	currentUserId: string | null;
	selected: readonly SelectedHumanMention[];
}): SelectedHumanMention[] {
	const seen = new Set<string>();
	const targets: SelectedHumanMention[] = [];
	for (const mention of selected) {
		if (
			mention.id === currentUserId ||
			seen.has(mention.id) ||
			!content.includes(`@${mention.label}`)
		) {
			continue;
		}
		seen.add(mention.id);
		targets.push(mention);
	}
	return targets;
}
