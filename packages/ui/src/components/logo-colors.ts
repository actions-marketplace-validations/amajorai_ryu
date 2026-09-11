/** Shared palette for the default logo and the 3D orb material. */
export const LOGO_DEFAULT_COLORS = {
	bg: "oklch(95% 0.02 264)",
	c1: "oklch(75% 0.18 300)",
	c2: "oklch(70% 0.20 264)",
	c3: "oklch(78% 0.15 230)",
} as const;

export type LogoColors = Partial<
	Record<keyof typeof LOGO_DEFAULT_COLORS, string>
>;
