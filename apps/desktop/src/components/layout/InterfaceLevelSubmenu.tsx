import { DashboardSpeed02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@ryu/ui/components/dropdown-menu";
import { RangeSlider } from "@ryu/ui/components/motion/range-slider";
import { cn } from "@ryu/ui/lib/utils";
import { useInterfaceLevel } from "@/src/hooks/useInterfaceLevel.ts";
import {
	INTERFACE_LEVELS,
	type InterfaceLevel,
	interfaceLevelIndex,
	setInterfaceLevel,
} from "@/src/lib/interface-level.ts";
import { LEVEL_RAMP_CLASS, levelFillColor } from "@/src/lib/level-ramp.ts";

/**
 * Account-menu submenu holding the Interface level ladder — the knob that
 * decides whether the app shows a chat box or a cockpit (see
 * `@/src/lib/interface-level.ts`).
 *
 * It lives in the account menu rather than only in Settings because the audience
 * it exists for is exactly the audience that does not open Settings: it has to
 * be two clicks from the avatar, next to Theme, or the people it was built for
 * will never find it.
 *
 * Rendered the same way as the composer's reasoning-effort control
 * (`EffortSliderRow`) and Appearance → Detail level: one detent per level, the
 * active level named above the track, every level captioned below it, and the
 * shared cool → hot fill ramp so all three read as one family of control.
 */
export function InterfaceLevelSubmenu() {
	const level = useInterfaceLevel();
	const activeIndex = interfaceLevelIndex(level);
	const active = INTERFACE_LEVELS[activeIndex];

	const handleChange = (next: number) => {
		const picked = INTERFACE_LEVELS[Math.round(next)];
		if (picked && picked.id !== level) {
			setInterfaceLevel(picked.id as InterfaceLevel);
		}
	};

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<HugeiconsIcon className="mr-2 size-4" icon={DashboardSpeed02Icon} />
				<span className="flex-1">Interface level</span>
				<span className="ml-2 text-muted-foreground text-xs">
					{active?.label}
				</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="min-w-72">
				{/* A plain div, NOT a DropdownMenuItem: an item would swallow the
				    pointer-down and close the menu on the first drag. And the menu owns
				    Arrow/Home/End for row navigation, so the slider's own key handling
				    has to stop here or a nudge would move the highlight, not the value. */}
				{/* biome-ignore lint/a11y/noStaticElementInteractions: key trap for a slider hosted in a menu */}
				<div
					className={cn("flex flex-col gap-1.5 px-2 py-1.5", LEVEL_RAMP_CLASS)}
					onKeyDown={(e) => e.stopPropagation()}
				>
					<div className="flex items-center justify-between gap-2">
						<span className="text-[13px] text-muted-foreground">
							How much you see
						</span>
						<span className="truncate text-[13px] text-foreground">
							{active?.label}
						</span>
					</div>
					<RangeSlider
						aria-label="Interface level"
						className="h-8"
						fillColor={levelFillColor(activeIndex, INTERFACE_LEVELS.length)}
						formatValueText={(v) =>
							INTERFACE_LEVELS[Math.round(v)]?.label ?? String(v)
						}
						max={INTERFACE_LEVELS.length - 1}
						min={0}
						onValueChange={handleChange}
						step={1}
						value={activeIndex}
					/>
					<div className="flex items-center justify-between gap-1">
						{INTERFACE_LEVELS.map((entry, i) => (
							<span
								className={cn(
									"flex-1 truncate text-[10px] leading-none",
									i === 0 && "text-left",
									i === INTERFACE_LEVELS.length - 1 && "text-right",
									i > 0 && i < INTERFACE_LEVELS.length - 1 && "text-center",
									i === activeIndex
										? "text-foreground"
										: "text-muted-foreground/70"
								)}
								key={entry.id}
							>
								{entry.label}
							</span>
						))}
					</div>
					<p className="text-[11px] text-muted-foreground leading-snug">
						{active?.description}
					</p>
				</div>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}
