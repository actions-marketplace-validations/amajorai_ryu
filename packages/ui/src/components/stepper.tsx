"use client";

// A "line" stepper: one horizontal track per step with its label underneath.
//
// Visual contract (see the Ryu design reference): every step owns an equal slice
// of the width. Its track is a thin rounded bar that reads as a progress bar —
// finished steps are fully filled, the current step fills to `progress` (0–1,
// default 1 so it looks complete-as-you-go), upcoming steps stay muted. Labels
// sit under the bar, foreground for reached steps and muted for the rest.
//
// It is deliberately NOT built on the Tabs primitive: a stepper is a linear
// flow with a notion of "reached" (you can go back, not skip ahead), and the
// bars carry progress, which tab indicators do not. Everything else — token
// usage, `cva` + `cn`, `data-slot` attributes — matches `tabs.tsx` so it sits
// inside the same design system.

import { cn } from "@ryu/ui/lib/utils.ts";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

export interface StepperStep {
	/** Stable id used for the active/selection value. */
	id: string;
	/** Label rendered under the bar. Keep it to one or two plain words. */
	label: string;
	/**
	 * Fill of this step's own bar, 0–1. Only read for the active step; finished
	 * steps always render full and upcoming ones empty. Use it when a single step
	 * has measurable inner progress (e.g. 2 of 5 fields filled).
	 */
	progress?: number;
}

const stepperSizeVariants = cva("flex w-full items-start", {
	variants: {
		size: {
			sm: "gap-3",
			default: "gap-4",
		},
	},
	defaultVariants: {
		size: "default",
	},
});

const trackHeight = {
	sm: "h-[3px]",
	default: "h-1",
} as const;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

type StepState = "done" | "current" | "upcoming";

function stepStateAt(index: number, activeIndex: number): StepState {
	if (index < activeIndex) {
		return "done";
	}
	if (index === activeIndex) {
		return "current";
	}
	return "upcoming";
}

function stepFill(state: StepState, progress: number | undefined): number {
	if (state === "done") {
		return 1;
	}
	if (state === "current") {
		return clamp01(progress ?? 1);
	}
	return 0;
}

export interface StepperProps
	extends VariantProps<typeof stepperSizeVariants>,
		Omit<React.ComponentProps<"nav">, "onSelect"> {
	/** Id of the step the user is on. */
	active: string;
	/**
	 * Called when a *reached* step's bar is clicked. Omit to make the stepper
	 * purely indicative (bars render as plain divs, not buttons).
	 */
	onSelect?: (id: string) => void;
	steps: StepperStep[];
}

/**
 * Line stepper. Steps before `active` count as finished; steps after it are
 * upcoming and cannot be jumped to — the flow owns forward movement, this only
 * offers backward navigation, which is what keeps a guided setup honest about
 * required fields.
 */
function Stepper({
	active,
	className,
	onSelect,
	size = "default",
	steps,
	...props
}: StepperProps) {
	const activeIndex = Math.max(
		0,
		steps.findIndex((step) => step.id === active)
	);
	const height = trackHeight[size ?? "default"];

	return (
		<nav
			aria-label="Progress"
			className={cn(stepperSizeVariants({ size }), className)}
			data-slot="stepper"
			{...props}
		>
			{steps.map((step, index) => {
				const state = stepStateAt(index, activeIndex);
				const current = state === "current";
				const reached = index <= activeIndex;
				const fill = stepFill(state, step.progress);
				const interactive = Boolean(onSelect) && state === "done";

				const body = (
					<>
						<span
							className={cn(
								"relative w-full overflow-hidden rounded-full bg-border",
								height
							)}
							data-slot="stepper-track"
						>
							<span
								className="block h-full rounded-full bg-foreground transition-[width] duration-300 ease-out"
								data-slot="stepper-indicator"
								style={{ width: `${fill * 100}%` }}
							/>
						</span>
						<span
							className={cn(
								"truncate text-left font-medium text-xs transition-colors",
								reached ? "text-foreground" : "text-muted-foreground/60"
							)}
							data-slot="stepper-label"
						>
							{step.label}
						</span>
					</>
				);

				const shared = {
					"aria-current": current ? ("step" as const) : undefined,
					className: cn(
						"flex min-w-0 flex-1 flex-col gap-2",
						interactive &&
							"cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					),
					"data-slot": "stepper-step",
					"data-state": state,
				};

				return interactive ? (
					<button
						{...shared}
						key={step.id}
						onClick={() => onSelect?.(step.id)}
						type="button"
					>
						{body}
					</button>
				) : (
					<div {...shared} key={step.id}>
						{body}
					</div>
				);
			})}
		</nav>
	);
}

export { Stepper };
