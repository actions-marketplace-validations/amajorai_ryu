import { isDitherColor } from "@ryu/ui/components/dither-kit/palette";
import { isExpressiveExpressionSelection } from "@ryu/ui/components/expressive.ts";
import { isExpressiveAnimationSelection } from "@ryu/ui/components/expressive-animation.ts";
import type { GlyphDitherValue, GlyphValue } from "@ryu/ui/components/glyph.ts";
import type { AgentPersona } from "@/src/lib/api/agents.ts";

// Persona ⇄ GlyphPicker conversion.
//
// An agent's avatar has six mutually-exclusive sources (uploaded image, icon,
// emoji, dicebear, expressive, dither), with dither additionally allowed as a BACKGROUND
// behind an icon or emoji. Getting that exclusivity wrong writes two sources at
// once and the wrong one wins at render.
//
// These lived inside `AgentEditPage` until the create-agent dialog needed the
// same conversion. Copying them would have been the third place in this repo to
// duplicate logic instead of moving it, so they moved here.

/** Fold a saved persona into a GlyphPicker value. */
export function personaToGlyphValue(
	persona: AgentPersona | null | undefined
): GlyphValue {
	if (!persona) {
		return null;
	}
	if (persona.avatar_url) {
		return { kind: "avatar", dataUrl: persona.avatar_url };
	}
	const expressive = persona.expressive?.expression;
	if (expressive && isExpressiveExpressionSelection(expressive)) {
		const animation = persona.expressive?.animation;
		return {
			kind: "expressive",
			expression: expressive,
			...(animation && isExpressiveAnimationSelection(animation)
				? { animation }
				: {}),
		};
	}
	const ditherLayer: GlyphDitherValue | undefined =
		persona.dither && isDitherColor(persona.dither.from)
			? {
					from: persona.dither.from,
					to: isDitherColor(persona.dither.to) ? persona.dither.to : null,
					direction:
						persona.dither.direction === "down" ||
						persona.dither.direction === "left" ||
						persona.dither.direction === "right"
							? persona.dither.direction
							: "up",
				}
			: undefined;
	if (persona.emoji) {
		return {
			kind: "emoji",
			emoji: persona.emoji,
			...(ditherLayer ? { dither: ditherLayer } : {}),
		};
	}
	if (persona.icon) {
		return {
			kind: "icon",
			id: persona.icon,
			...(persona.icon_color ? { color: persona.icon_color } : {}),
			...(ditherLayer ? { dither: ditherLayer } : {}),
		};
	}
	if (persona.dicebear?.style && persona.dicebear.seed) {
		return {
			kind: "dicebear",
			style: persona.dicebear.style,
			seed: persona.dicebear.seed,
		};
	}
	if (ditherLayer) {
		return { kind: "dither", dither: ditherLayer };
	}
	return null;
}

/** Split a GlyphPicker value into persona avatar fields.
 * Dither may coexist with icon/emoji as a background; never with dicebear/avatar. */
export function glyphToPersonaFields(
	glyph: GlyphValue
): Pick<
	AgentPersona,
	| "avatar_url"
	| "emoji"
	| "icon"
	| "icon_color"
	| "dicebear"
	| "expressive"
	| "dither"
> {
	const ditherBg =
		glyph?.kind === "icon" || glyph?.kind === "emoji"
			? (glyph.dither ?? null)
			: glyph?.kind === "dither"
				? glyph.dither
				: null;
	return {
		avatar_url: glyph?.kind === "avatar" ? glyph.dataUrl : null,
		expressive:
			glyph?.kind === "expressive"
				? {
						expression: glyph.expression,
						...(glyph.animation ? { animation: glyph.animation } : {}),
					}
				: null,
		emoji: glyph?.kind === "emoji" ? glyph.emoji : null,
		icon: glyph?.kind === "icon" ? glyph.id : null,
		icon_color: glyph?.kind === "icon" ? (glyph.color ?? null) : null,
		dicebear:
			glyph?.kind === "dicebear"
				? { style: glyph.style, seed: glyph.seed }
				: null,
		dither: ditherBg,
	};
}
