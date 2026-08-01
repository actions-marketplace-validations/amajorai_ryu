"use client";

// The proactive suggestion chip inside the morphing island (Island U4).
//
// Renders a single surfaced suggestion: title + one-line body. The Accept /
// Snooze / Dismiss actions are NOT here: the island draws them as their own
// mini-islands in the row beneath this chip (see apps/island Island.tsx), so
// this component stays purely presentational. Auto-collapse is driven by a timer
// in the island's suggestion queue (use-suggestion-queue), not by this view.
//
// Prior art: apps/desktop/src/components/companion/SuggestionChip.tsx. This
// variant is dark-on-glass to match the island shell.

/** Structural shape of a surfaced suggestion (matches the island queue item). */
export interface IslandSuggestionView {
	body: string;
	title: string;
}

export interface IslandSuggestionChipProps {
	suggestion?: IslandSuggestionView;
	/**
	 * Let the title/body wrap onto more lines instead of truncating each to one.
	 * Only safe on a surface whose height tracks its content (the desktop island
	 * pill measures this chip and grows); the web island's chip sits in a
	 * fixed-height shape, so it keeps the single-line default.
	 */
	wrap?: boolean;
}

const DEMO_SUGGESTION: IslandSuggestionView = {
	title: "Summarize this PR diff?",
	body: "You have been reviewing changes for 4 minutes",
};

export function IslandSuggestionChip({
	suggestion = DEMO_SUGGESTION,
	wrap = false,
}: IslandSuggestionChipProps) {
	const lineClass = wrap ? "break-words" : "truncate";
	return (
		<section
			aria-label="Proactive suggestion"
			className="flex w-full items-start gap-2.5 px-1"
		>
			<span className="mt-1 size-2 shrink-0 rounded-full bg-amber-400" />
			<div className="min-w-0 flex-1">
				<p
					className={`font-medium text-neutral-100 text-sm leading-tight ${lineClass}`}
				>
					{suggestion.title}
				</p>
				{suggestion.body.trim().length > 0 ? (
					<p className={`text-neutral-400 text-xs leading-tight ${lineClass}`}>
						{suggestion.body}
					</p>
				) : null}
			</div>
		</section>
	);
}
