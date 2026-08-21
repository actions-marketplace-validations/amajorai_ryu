"use client";

import type { ReactNode } from "react";

import { Toolbar } from "./toolbar.tsx";

/**
 * Compatibility wrapper for the fixed-toolbar plugin slot.
 *
 * The toolbar itself now owns its fixed positioning through the shared nested
 * overflow primitive, so this slot must not reserve a second sticky row above the
 * editor.
 */
export function FixedToolbar({ children }: { children: ReactNode }) {
	return (
		<Toolbar className="w-full" role="presentation">
			{children}
		</Toolbar>
	);
}
