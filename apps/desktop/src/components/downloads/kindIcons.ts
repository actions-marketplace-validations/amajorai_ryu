// apps/desktop/src/components/downloads/kindIcons.ts
//
// One glyph per artifact family, shared by the download rows and the
// available-updates rows so the same kind never wears two different icons
// across the tray. Keyed loosely (string) because Core's `DownloadKind` and the
// desktop's `UpdateKind` overlap but are not identical — `other` is the
// fallback for anything unmapped.

import {
	AiBrain01Icon,
	AudioWave01Icon,
	CpuIcon,
	Image02Icon,
	Package01Icon,
	PlugSocketIcon,
	PuzzleIcon,
	Robot01Icon,
	Rocket01Icon,
	SparklesIcon,
	Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

export const KIND_ICON: Record<string, IconSvgElement> = {
	agent: Robot01Icon,
	app: Rocket01Icon,
	embedding: AiBrain01Icon,
	engine: CpuIcon,
	mcp: PlugSocketIcon,
	media: Image02Icon,
	model: SparklesIcon,
	other: Package01Icon,
	plugin: PuzzleIcon,
	skill: PuzzleIcon,
	tool: Wrench01Icon,
	voice: AudioWave01Icon,
};

/** The glyph for a kind, falling back to the generic package. */
export function kindIcon(kind: string): IconSvgElement {
	return KIND_ICON[kind] ?? KIND_ICON.other;
}
