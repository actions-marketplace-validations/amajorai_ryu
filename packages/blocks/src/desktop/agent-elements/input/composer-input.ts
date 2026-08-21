/**
 * A composer has input when it contains text or at least one staged attachment.
 * Attachment-only turns still need the normal send action, including when live
 * voice mode is available as the empty-composer affordance.
 */
export function hasComposerInput(
	text: string,
	attachmentCount: number
): boolean {
	return text.trim().length > 0 || attachmentCount > 0;
}
