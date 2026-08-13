import { cn } from "@ryu/ui/lib/utils";

/** Landing card accents — one distinct hue per section card. */
export type LandingCardTone =
	| "orange"
	| "blue"
	| "pink"
	| "purple"
	| "yellow"
	| "green"
	| "teal";

interface LandingCardToneTokens {
	body: string;
	bullet: string;
	cta: string;
	ctaSecondary: string;
	eyebrow: string;
	marker: string;
	surface: string;
	title: string;
}

export const LANDING_CARD_TONES: Record<
	LandingCardTone,
	LandingCardToneTokens
> = {
	orange: {
		surface: "bg-[#ffe0b3] dark:bg-[#3d2209]/80",
		eyebrow: "text-[#8a5318]/70 dark:text-[#fbbf24]/70",
		title: "text-[#5c3608] dark:text-[#fbbf24]",
		body: "text-[#6d4210]/85 dark:text-[#fcd34d]/85",
		bullet: "text-[#5c3608]/90 dark:text-[#fbbf24]/90",
		marker: "text-[#6d4210] dark:text-[#f59e0b]",
		cta: "border border-[#5c3608] bg-transparent text-[#5c3608] hover:bg-[#5c3608]/12 hover:text-[#5c3608] dark:border-[#fbbf24]/60 dark:text-[#fbbf24] dark:hover:bg-[#fbbf24]/12",
		ctaSecondary:
			"text-[#5c3608] hover:bg-[#5c3608]/10 hover:text-[#5c3608] dark:text-[#fbbf24] dark:hover:bg-[#fbbf24]/10",
	},
	blue: {
		surface: "bg-[#dbeafe] dark:bg-[#172554]/80",
		eyebrow: "text-[#1e3a5f]/65 dark:text-[#93c5fd]/65",
		title: "text-[#1e3a5f] dark:text-[#93c5fd]",
		body: "text-[#1e3a5f]/85 dark:text-[#bfdbfe]/85",
		bullet: "text-[#1e3a5f]/90 dark:text-[#93c5fd]/90",
		marker: "text-[#1d4ed8] dark:text-[#60a5fa]",
		cta: "border border-[#1e3a5f] bg-transparent text-[#1e3a5f] hover:bg-[#1e3a5f]/12 hover:text-[#1e3a5f] dark:border-[#93c5fd]/60 dark:text-[#93c5fd] dark:hover:bg-[#93c5fd]/12",
		ctaSecondary:
			"text-[#1e3a5f] hover:bg-[#1e3a5f]/10 hover:text-[#1e3a5f] dark:text-[#93c5fd] dark:hover:bg-[#93c5fd]/10",
	},
	pink: {
		surface: "bg-[#fce7f3] dark:bg-[#500724]/80",
		eyebrow: "text-[#831843]/65 dark:text-[#f9a8d4]/65",
		title: "text-[#831843] dark:text-[#f9a8d4]",
		body: "text-[#9d174d]/85 dark:text-[#fbcfe8]/85",
		bullet: "text-[#831843]/90 dark:text-[#f9a8d4]/90",
		marker: "text-[#be185d] dark:text-[#f472b6]",
		cta: "border border-[#831843] bg-transparent text-[#831843] hover:bg-[#831843]/12 hover:text-[#831843] dark:border-[#f9a8d4]/60 dark:text-[#f9a8d4] dark:hover:bg-[#f9a8d4]/12",
		ctaSecondary:
			"text-[#831843] hover:bg-[#831843]/10 hover:text-[#831843] dark:text-[#f9a8d4] dark:hover:bg-[#f9a8d4]/10",
	},
	purple: {
		surface: "bg-[#ede9fe] dark:bg-[#3b0764]/80",
		eyebrow: "text-[#4c1d95]/65 dark:text-[#c4b5fd]/65",
		title: "text-[#4c1d95] dark:text-[#c4b5fd]",
		body: "text-[#5b21b6]/85 dark:text-[#ddd6fe]/85",
		bullet: "text-[#4c1d95]/90 dark:text-[#c4b5fd]/90",
		marker: "text-[#6d28d9] dark:text-[#a78bfa]",
		cta: "border border-[#4c1d95] bg-transparent text-[#4c1d95] hover:bg-[#4c1d95]/12 hover:text-[#4c1d95] dark:border-[#c4b5fd]/60 dark:text-[#c4b5fd] dark:hover:bg-[#c4b5fd]/12",
		ctaSecondary:
			"text-[#4c1d95] hover:bg-[#4c1d95]/10 hover:text-[#4c1d95] dark:text-[#c4b5fd] dark:hover:bg-[#c4b5fd]/10",
	},
	yellow: {
		surface: "bg-[#fef3c7] dark:bg-[#422006]/80",
		eyebrow: "text-[#92400e]/65 dark:text-[#fcd34d]/65",
		title: "text-[#78350f] dark:text-[#fcd34d]",
		body: "text-[#92400e]/85 dark:text-[#fef08a]/85",
		bullet: "text-[#78350f]/90 dark:text-[#fcd34d]/90",
		marker: "text-[#b45309] dark:text-[#facc15]",
		cta: "border border-[#78350f] bg-transparent text-[#78350f] hover:bg-[#78350f]/12 hover:text-[#78350f] dark:border-[#fcd34d]/60 dark:text-[#fcd34d] dark:hover:bg-[#fcd34d]/12",
		ctaSecondary:
			"text-[#78350f] hover:bg-[#78350f]/10 hover:text-[#78350f] dark:text-[#fcd34d] dark:hover:bg-[#fcd34d]/10",
	},
	green: {
		surface: "bg-[#dcfce7] dark:bg-[#052e16]/80",
		eyebrow: "text-[#166534]/65 dark:text-[#86efac]/65",
		title: "text-[#14532d] dark:text-[#86efac]",
		body: "text-[#166534]/85 dark:text-[#bbf7d0]/85",
		bullet: "text-[#14532d]/90 dark:text-[#86efac]/90",
		marker: "text-[#15803d] dark:text-[#4ade80]",
		cta: "border border-[#14532d] bg-transparent text-[#14532d] hover:bg-[#14532d]/12 hover:text-[#14532d] dark:border-[#86efac]/60 dark:text-[#86efac] dark:hover:bg-[#86efac]/12",
		ctaSecondary:
			"text-[#14532d] hover:bg-[#14532d]/10 hover:text-[#14532d] dark:text-[#86efac] dark:hover:bg-[#86efac]/10",
	},
	teal: {
		surface: "bg-[#ccfbf1] dark:bg-[#042f2e]/80",
		eyebrow: "text-[#115e59]/65 dark:text-[#5eead4]/65",
		title: "text-[#134e4a] dark:text-[#5eead4]",
		body: "text-[#115e59]/85 dark:text-[#99f6e4]/85",
		bullet: "text-[#134e4a]/90 dark:text-[#5eead4]/90",
		marker: "text-[#0d9488] dark:text-[#2dd4bf]",
		cta: "border border-[#134e4a] bg-transparent text-[#134e4a] hover:bg-[#134e4a]/12 hover:text-[#134e4a] dark:border-[#5eead4]/60 dark:text-[#5eead4] dark:hover:bg-[#5eead4]/12",
		ctaSecondary:
			"text-[#134e4a] hover:bg-[#134e4a]/10 hover:text-[#134e4a] dark:text-[#5eead4] dark:hover:bg-[#5eead4]/10",
	},
};

export function landingCardSurfaceClass(tone: LandingCardTone) {
	return cn("h-full rounded-2xl p-4 md:p-5", LANDING_CARD_TONES[tone].surface);
}

export const landingMutedCardSurfaceClass =
	"h-full rounded-2xl bg-muted/40 p-4 md:p-5";

/** Muted surface cards on the landing page (no tone). */
export const landingSurfaceCardClass =
	"rounded-2xl bg-muted/50 p-4 backdrop-blur-sm transition-colors duration-200 hover:bg-muted/70";

export const landingSurfaceCardFlexClass =
	"flex h-full flex-col gap-3 rounded-2xl bg-muted/50 p-4 backdrop-blur-sm transition-colors duration-200 hover:bg-muted/70";

export const landingSurfaceCardXlClass =
	"rounded-xl bg-muted/50 p-4 backdrop-blur-sm transition-colors duration-200 hover:bg-muted/70";

export const landingSurfaceCardFlexXlClass =
	"flex h-full flex-col justify-between gap-4 rounded-xl bg-muted/50 p-4 backdrop-blur-sm transition-colors duration-200 hover:bg-muted/70";
