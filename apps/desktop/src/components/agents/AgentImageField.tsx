// Thin agent-facing wrapper around the shared GlyphPicker primitive
// (`@ryu/ui/components/glyph-picker`). Agents use the `"agent"` preset
// (avatar · icon · emoji · dicebear · dither). Re-exports the glyph types under
// the historical `AgentAvatarValue` / `AgentDitherValue` names so existing
// call sites keep compiling.

import type { GlyphDitherValue, GlyphValue } from "@ryu/ui/components/glyph.ts";
import { GlyphPicker } from "@ryu/ui/components/glyph-picker.tsx";
import type { ReactNode } from "react";

/** @deprecated Prefer `GlyphDitherValue` from `@ryu/ui/components/glyph`. */
export type AgentDitherValue = GlyphDitherValue;

/** @deprecated Prefer `GlyphValue` from `@ryu/ui/components/glyph`. */
export type AgentAvatarValue = GlyphValue;

interface AgentImageFieldProps {
	className?: string;
	disabled?: boolean;
	/** Rendered when no custom avatar is set (typically the engine logo). */
	fallback: ReactNode;
	/** Called with the picked avatar source, or null when removed. */
	onChange: (value: AgentAvatarValue) => void;
	/** Current avatar value across all sources, or null. */
	value: AgentAvatarValue;
}

export function AgentImageField({
	value,
	onChange,
	fallback,
	disabled = false,
	className,
}: AgentImageFieldProps) {
	return (
		<GlyphPicker
			allowed="agent"
			className={className}
			disabled={disabled}
			fallback={fallback}
			onChange={onChange}
			previewSize={40}
			title="Agent avatar"
			value={value}
		/>
	);
}
