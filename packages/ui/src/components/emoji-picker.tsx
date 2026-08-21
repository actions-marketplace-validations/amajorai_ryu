"use client";

import emojiMartData from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

export interface EmojiPickerSelection {
	native: string;
}

export interface EmojiPickerProps {
	onEmojiSelect: (emoji: EmojiPickerSelection) => void;
}

/**
 * Shared EmojiMart picker with the product's default presentation settings.
 * Consumers only need to handle the selected native emoji.
 */
export function EmojiPicker({ onEmojiSelect }: EmojiPickerProps) {
	return (
		<Picker
			data={emojiMartData}
			dynamicWidth
			emojiButtonSize={32}
			emojiSize={20}
			maxFrequentRows={1}
			navPosition="bottom"
			onEmojiSelect={onEmojiSelect}
			previewPosition="none"
			skinTonePosition="search"
			theme="auto"
		/>
	);
}
