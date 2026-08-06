"use client";

// The composer picker's reasoning-effort control: one stepped detent per level
// the ACTIVE source advertises, not a fixed low→xhigh ladder.
//
// Two sources feed it and neither is hardcoded here:
//   - a Pi PROVIDER row  — `catalog.thinkingLevels` (use-universal-picker.ts),
//   - an external ACP AGENT — its own `select` config option, classified by
//     `isReasoningOption` in packages/blocks/src/composer/composer-acp-sections.ts.
//
// Both arrive as a `ComposerSettingsSection` whose `items` are already in the
// advertised order, so "autodetect" is just: render the live list. An agent with
// three levels gets three detents; Pi's `off · low · medium · high · max` gets
// five. Nothing renders at all when the source advertises nothing, and the
// reasoning-off capability override drops the section upstream, so a suppressed
// picker never leaves a dead track behind.

import { RangeSlider } from "@ryu/ui/components/motion/range-slider";
import { cn } from "@ryu/ui/lib/utils.ts";
import { useCallback } from "react";
import type { ComposerSettingsSection } from "@/components/agent-elements/input/composer-settings-menu.tsx";

/** Above this many levels the per-detent captions stop fitting the popover. */
const MAX_CAPTIONED_LEVELS = 5;

export function EffortSliderRow({
	section,
	onSelect,
}: {
	/** Called with the picked item id (the section's own `onChange` wrapper). */
	onSelect: (id: string) => void;
	section: ComposerSettingsSection;
}) {
	const { items } = section;
	const activeIndex = Math.max(
		0,
		items.findIndex((it) => it.id === section.value)
	);
	const active = items[activeIndex];

	const handleChange = useCallback(
		(next: number) => {
			const picked = items[Math.round(next)];
			if (picked && picked.id !== section.value) {
				onSelect(picked.id);
			}
		},
		[items, onSelect, section.value]
	);

	if (items.length < 2) {
		return null;
	}

	const showCaptions = items.length <= MAX_CAPTIONED_LEVELS;

	return (
		// The menu owns arrow keys for row navigation, so the slider's own
		// Arrow/Home/End handling has to stop here or a nudge would move the
		// highlight instead of the value.
		<div
			className="flex flex-col gap-1.5 px-2 py-1.5"
			onKeyDown={(e) => e.stopPropagation()}
		>
			<div className="flex items-center justify-between gap-2">
				<span className="text-[13px] text-muted-foreground">
					{section.label}
				</span>
				<span className="max-w-[140px] truncate text-[13px] text-foreground">
					{active?.name}
				</span>
			</div>
			<RangeSlider
				aria-label={section.ariaLabel}
				className="h-8"
				formatValueText={(v) => items[Math.round(v)]?.name ?? String(v)}
				max={items.length - 1}
				min={0}
				onValueChange={handleChange}
				step={1}
				value={activeIndex}
			/>
			{showCaptions && (
				<div className="flex items-center justify-between gap-1">
					{items.map((item, i) => (
						<span
							className={cn(
								"flex-1 truncate text-[10px] leading-none",
								i === 0 && "text-left",
								i === items.length - 1 && "text-right",
								i > 0 && i < items.length - 1 && "text-center",
								i === activeIndex
									? "text-foreground"
									: "text-muted-foreground/70"
							)}
							key={item.id}
						>
							{item.name}
						</span>
					))}
				</div>
			)}
		</div>
	);
}
