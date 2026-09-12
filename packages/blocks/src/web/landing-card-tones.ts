/** Compatibility names for existing content; public pages share one semantic palette. */
export type LandingCardTone =
	| "orange"
	| "blue"
	| "pink"
	| "purple"
	| "yellow"
	| "green"
	| "teal";

const neutralTone = {
	body: "text-muted-foreground",
	bullet: "text-foreground",
	cta: "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-none",
	ctaSecondary: "text-foreground hover:bg-muted",
	eyebrow: "text-muted-foreground",
	marker: "text-muted-foreground",
	surface: "bg-transparent",
	title: "text-foreground",
};

export const LANDING_CARD_TONES: Record<LandingCardTone, typeof neutralTone> = {
	orange: neutralTone,
	blue: neutralTone,
	pink: neutralTone,
	purple: neutralTone,
	yellow: neutralTone,
	green: neutralTone,
	teal: neutralTone,
};

export function landingCardSurfaceClass(_tone: LandingCardTone) {
	return "h-full py-6";
}

export const landingMutedCardSurfaceClass = "h-full bg-muted/40 p-6";
export const landingVisualFrameClass =
	"overflow-hidden rounded-[2rem] bg-muted/40 p-2 md:p-3";
export const landingSurfaceCardClass = "py-6";
export const landingSurfaceCardFlexClass = "flex h-full flex-col gap-5 py-6";
export const landingSurfaceCardXlClass = "py-6";
export const landingSurfaceCardFlexXlClass =
	"flex h-full flex-col justify-between gap-6 py-6";
