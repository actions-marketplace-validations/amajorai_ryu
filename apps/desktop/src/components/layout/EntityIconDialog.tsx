// Thin host around the shared GlyphPicker for spaces, pages, and other
// server-persisted entities (`allowed="entity"`).

import type { GlyphValue } from "@ryu/ui/components/glyph.ts";
import { GlyphPicker } from "@ryu/ui/components/glyph-picker.tsx";

/** Controlled GlyphPicker for a space / page / meeting-style entity icon. */
export function EntityIconDialog({
	title,
	description,
	value,
	open,
	onOpenChange,
	onChange,
}: {
	description?: string;
	onChange: (next: GlyphValue) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	title: string;
	value: GlyphValue;
}) {
	return (
		<GlyphPicker
			allowed="entity"
			description={description}
			onChange={(next) => {
				onChange(next);
				onOpenChange(false);
			}}
			onOpenChange={onOpenChange}
			open={open}
			title={title}
			value={value}
		/>
	);
}
