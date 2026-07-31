// GuidedSetup — the step-by-step shell every "create a new thing" flow uses.
//
// Why this exists: the agent editor exposes ~40 settings across a tab strip.
// That is the right surface for *editing* an agent you already understand, and
// the wrong one for *creating* your first. This shell narrows the same settings
// into a handful of named steps: a line stepper on top (bars fill as you go),
// one step's fields at a time, and a single primary action.
//
// Content is passed in, never imported here, so this stays a generic shell with
// no knowledge of agents (and no import cycle with the editor that renders it).

import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button";
import { Spinner } from "@ryu/ui/components/spinner";
import { Stepper, type StepperStep } from "@ryu/ui/components/stepper";
// biome-ignore lint/correctness/noUnresolvedImports: ReactNode is a valid React export; biome's resolver misreports it
import { type ReactNode, useMemo, useState } from "react";

export interface GuidedStep {
	/**
	 * Blocks Continue while set, and shows as the reason under the buttons. Use
	 * for required fields ("Give your agent a name first").
	 */
	blockedReason?: string | null;
	/** Rendered inside the step body. */
	content: ReactNode;
	/** One plain-language sentence under the step title. */
	hint?: string;
	/** Stable id. */
	id: string;
	/** Word under the stepper bar — keep it to one or two words. */
	label: string;
	/** Heading above the step body. Defaults to `label`. */
	title?: string;
}

export interface GuidedSetupProps {
	busy?: boolean;
	/** Error text rendered above the actions. */
	error?: ReactNode;
	/** Blocks both finish actions (e.g. nothing installed to run the agent on). */
	finishDisabled?: boolean;
	/** Label for the action on the last step. */
	finishLabel?: string;
	/** Small print under the actions. */
	footnote?: ReactNode;
	/** Header above the stepper (agent icon + name field, a title, anything). */
	header?: ReactNode;
	/** Leaves the flow entirely (discards). Hidden when omitted. */
	onCancel?: () => void;
	onFinish: () => void;
	/** Escape hatch to the full tabbed editor. Hidden when omitted. */
	onSkip?: () => void;
	/** Secondary action on the last step (e.g. "Save without chatting"). */
	secondaryFinish?: { label: string; onClick: () => void } | null;
	skipLabel?: string;
	steps: GuidedStep[];
}

/**
 * Linear step flow. Forward movement is gated on the current step's
 * `blockedReason`; backward movement is always allowed, including by clicking a
 * finished bar in the stepper.
 */
export function GuidedSetup({
	busy,
	error,
	finishDisabled,
	finishLabel = "Finish",
	footnote,
	header,
	onCancel,
	onFinish,
	onSkip,
	secondaryFinish,
	skipLabel = "Set it up myself",
	steps,
}: GuidedSetupProps) {
	const [activeId, setActiveId] = useState(steps[0]?.id ?? "");
	const index = Math.max(
		0,
		steps.findIndex((step) => step.id === activeId)
	);
	const step = steps[index];
	const last = index === steps.length - 1;
	const blocked = step?.blockedReason ?? null;

	const stepperSteps = useMemo<StepperStep[]>(
		() => steps.map(({ id, label }) => ({ id, label })),
		[steps]
	);

	if (!step) {
		return null;
	}

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-7">
			{header}

			<Stepper active={step.id} onSelect={setActiveId} steps={stepperSteps} />

			<div className="flex flex-col gap-5">
				<div className="flex flex-col gap-1">
					<h2 className="font-semibold text-base">
						{step.title ?? step.label}
					</h2>
					{step.hint ? (
						<p className="text-muted-foreground text-sm leading-snug">
							{step.hint}
						</p>
					) : null}
				</div>
				<div className="flex flex-col gap-6">{step.content}</div>
			</div>

			{error ? <p className="text-destructive text-sm">{error}</p> : null}

			<div className="flex flex-wrap items-center gap-2 border-t pt-5">
				{index > 0 ? (
					<Button
						onClick={() => setActiveId(steps[index - 1].id)}
						variant="ghost"
					>
						<HugeiconsIcon className="size-4" icon={ArrowLeft01Icon} />
						Back
					</Button>
				) : null}

				{last ? (
					<>
						<Button disabled={busy || finishDisabled} onClick={onFinish}>
							{busy ? <Spinner /> : null}
							{finishLabel}
						</Button>
						{secondaryFinish ? (
							<Button
								disabled={busy || finishDisabled}
								onClick={secondaryFinish.onClick}
								variant="ghost"
							>
								{secondaryFinish.label}
							</Button>
						) : null}
					</>
				) : (
					<Button
						disabled={Boolean(blocked)}
						onClick={() => setActiveId(steps[index + 1].id)}
					>
						Continue
						<HugeiconsIcon className="size-4" icon={ArrowRight01Icon} />
					</Button>
				)}

				{onCancel ? (
					<Button onClick={onCancel} variant="ghost">
						Cancel
					</Button>
				) : null}

				{onSkip ? (
					<Button className="ml-auto" onClick={onSkip} variant="ghost">
						{skipLabel}
					</Button>
				) : null}
			</div>

			{blocked ? (
				<p className="text-muted-foreground text-xs">{blocked}</p>
			) : null}
			{footnote}
		</div>
	);
}
