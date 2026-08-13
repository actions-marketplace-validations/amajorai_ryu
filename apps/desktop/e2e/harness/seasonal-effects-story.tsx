// Standalone browser story for the REAL `SeasonalParticles` — the holiday
// effect that falls down the titlebar.
//
// It exists because this feature is unobservable in normal development: the
// calendar only opens a window on a handful of days a year, so for ~340 days
// "it compiles" is the ONLY feedback the code gives you. Worse, everything that
// can go wrong here is a painted-pixel property, not a data property — the
// particles rendering behind the titlebar background, the emoji covering a tab
// label, a glyph-based season (Christmas is a white "*") vanishing on a light
// theme, or the fade at the bottom edge cutting in the wrong place.
//
// So each season is mounted over the real titlebar chrome (the same
// `bg-background` strip, tab pills at the real `z-10`, the real mask), in BOTH
// themes. Screenshot it and look: particles must be visible over the bar,
// never on top of a tab label, in both columns.

import { createRoot } from "react-dom/client";
import {
	getSeasonDisplayEmoji,
	SEASONS,
	SeasonalParticles,
} from "../../src/components/layout/SeasonalEffects.tsx";
import "../../src/index.css";

/** A stripped-down copy of the titlebar's layering, same z-indexes. */
function TitleBarStrip({ seasonId }: { seasonId: string }) {
	const season = SEASONS.find((s) => s.id === seasonId);
	if (!season) {
		return null;
	}
	return (
		<div
			className="relative flex h-12 w-full items-center px-2"
			data-season={season.id}
			data-testid="season-strip"
		>
			<div
				aria-hidden
				className="pointer-events-none absolute top-0 left-0 h-12 w-full bg-background"
			/>
			<SeasonalParticles
				color={season.color}
				count={30}
				emoji={season.emoji}
				fadeBottom
				maxOpacity={1}
				maxSize={season.maxSize ?? 30}
				minOpacity={0}
				minSize={season.minSize ?? 1}
				zIndex={1}
			/>
			<div
				className="relative z-10 flex w-full items-center gap-2"
				data-testid="tab-row"
			>
				<div className="rounded-lg bg-muted px-3 py-1 text-sm">New chat</div>
				<div className="rounded-lg px-3 py-1 text-muted-foreground text-sm">
					Library
				</div>
				<div className="rounded-lg px-3 py-1 text-muted-foreground text-sm">
					Settings
				</div>
			</div>
		</div>
	);
}

function Column({ mode }: { mode: "light" | "dark" }) {
	return (
		<div className={mode}>
			<div className="w-[520px] bg-background p-4 text-foreground">
				<p className="mb-3 font-medium text-sm">{mode}</p>
				{SEASONS.map((season) => (
					<div className="mb-4" key={season.id}>
						<p className="mb-1 text-muted-foreground text-xs">
							{getSeasonDisplayEmoji(season)} {season.label}
						</p>
						<div className="overflow-hidden rounded-xl border border-border">
							<TitleBarStrip seasonId={season.id} />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function Story() {
	return (
		<div className="flex gap-4 p-4">
			<Column mode="light" />
			<Column mode="dark" />
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
