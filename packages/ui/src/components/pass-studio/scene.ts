/**
 * The pass, turning, drawn into an export-sized canvas.
 *
 * The card here is the REAL card, not a lookalike: the backdrop is the same
 * `warp` shader the live pass is printed on, sampled straight off its WebGL
 * canvas, and the ring is the same `metal-fx` instance the live pass wears,
 * sampled off the 2D canvas the library composites it onto. Only the type layer
 * is redrawn (see `paint.ts`), because DOM text is the one thing a canvas
 * cannot borrow.
 *
 * The 3D is done here rather than by CSS because a `<canvas>` is the only
 * surface `MediaRecorder` and `toBlob` can both read, and CSS transforms do not
 * exist inside one. The card is projected by hand: each vertical strip of the
 * visible face is placed at its own perspective-divided x and height, which is
 * what a `rotateY` under a 1000px perspective actually does. At the strip count
 * below the seams are sub-pixel.
 */

import { METAL_EDGE_RING_PX } from "../metal-edge.tsx";
import {
	CARD_RADIUS_PX,
	CARD_THICKNESS_PX,
	FLOAT_TRAVEL_PX,
	PERSPECTIVE_PX,
	WARP_OPACITY_DARK,
	WARP_OPACITY_LIGHT,
} from "../pass-card-shell.tsx";
import { EDGE_METAL_STOPS } from "../pass-edge.ts";
import type { PassFormat } from "./formats.ts";
import { PASS_LOOP_SECONDS } from "./formats.ts";
import {
	CARD_HEIGHT_PX,
	CARD_WIDTH_PX,
	drawGhost,
	faceRect,
	ghostEyesAt,
	type PassFaceEnv,
	type PassFacePainter,
	type PassPalette,
	paintBackType,
} from "./paint.ts";

/**
 * How many vertical strips the visible face is cut into for the perspective
 * divide. 96 puts a strip every ~3px of a 320px card; the projection is smooth
 * enough by 48 that the extra cost buys only the corners, and cheap enough at 96
 * that a 30fps 1080p loop still has headroom.
 */
const PROJECTION_STRIPS = 96;
/**
 * The face is rasterized at 3x the card's CSS size before it is projected. The
 * projection only ever shrinks a strip (perspective divides toward the far
 * edge), so supersampling is what keeps the type crisp instead of resampled —
 * and 3x is where a 1080-tall card stops improving.
 */
const FACE_SUPERSAMPLE = 3;
/** `opacity-[0.16]` on the foil sheen, at the live card's 115deg. */
const FOIL_OPACITY = 0.16;
const FOIL_ANGLE_DEG = 115;
/** How far the specular sweep travels per revolution, and how hot it gets. */
const SWEEP_OPACITY = 0.18;
/**
 * The soft wash of the card's own colour behind it. Exported because the wash
 * arrives as two finished colour strings (see `PassBackdropSpec`), so whoever
 * builds them has to bake this alpha in rather than inventing a second one.
 */
export const BACKDROP_WASH_ALPHA = 0.16;
/** The card's cast shadow, at rest and at the widest point of the turn. */
const SHADOW_BLUR_RATIO = 0.09;
const SHADOW_ALPHA = 0.36;
/** The footer lockup — mark plus host — as a fraction of the frame's short edge. */
const FOOTER_MARK_RATIO = 0.032;
const FOOTER_GAP_RATIO = 0.012;
const FOOTER_MARGIN_RATIO = 0.055;
/**
 * How long the ring spends dissolving back to its opening state at the end of a
 * cycle.
 *
 * The ring is the one element that cannot be driven from loop time: `metal-fx`
 * runs a single shared rAF for every ring on the page and exposes no clock, so
 * its shimmer is wherever wall time left it. Freezing it to one frame loops
 * perfectly and looks dead. Instead it runs live for the whole cycle and, over
 * this last stretch, cross-fades to a copy of its own first frame — so the final
 * frame IS the opening frame and the file loops, while the band is genuinely
 * animating for the other 94% of it. Long enough to read as a dissolve rather
 * than a cut, short enough that the shimmer never visibly stalls.
 */
const RING_FADE_SECONDS = 0.6;

/**
 * Place a card-shaped bitmap into the scene under a `rotateY`.
 *
 * The face is cut into vertical strips and each is drawn at its own
 * perspective-divided x and height, which is what a CSS `rotateY` under a
 * 1000px perspective actually computes. Both the visible face and the milled
 * edge behind it go through here, at different depths — projecting them the same
 * way is what keeps their two silhouettes in register at the rounded corners.
 */
function projectFace(
	ctx: CanvasRenderingContext2D,
	bitmap: HTMLCanvasElement,
	{
		cardHeight,
		cardWidth,
		centerY,
		mirrored,
		plane,
		project,
	}: {
		cardHeight: number;
		cardWidth: number;
		centerY: number;
		/** Read the source right-to-left — the back face seen through the card. */
		mirrored: boolean;
		/** Depth of this bitmap's plane, in scene units either side of the mid-plane. */
		plane: number;
		project: (u: number, w: number) => { f: number; x: number };
	}
): void {
	const step = cardWidth / PROJECTION_STRIPS;
	ctx.save();
	ctx.imageSmoothingQuality = "high";
	for (let i = 0; i < PROJECTION_STRIPS; i++) {
		const u0 = -cardWidth / 2 + i * step;
		const a = project(u0, plane);
		const b = project(u0 + step, plane);
		const spread = Math.abs(b.x - a.x);
		if (spread < 0.01) {
			continue;
		}
		const f = (a.f + b.f) / 2;
		const drawnHeight = cardHeight * f;
		const t0 = mirrored ? 1 - i / PROJECTION_STRIPS : i / PROJECTION_STRIPS;
		const t1 = mirrored
			? 1 - (i + 1) / PROJECTION_STRIPS
			: (i + 1) / PROJECTION_STRIPS;
		ctx.drawImage(
			bitmap,
			Math.min(t0, t1) * bitmap.width,
			0,
			Math.abs(t1 - t0) * bitmap.width,
			bitmap.height,
			Math.min(a.x, b.x),
			centerY - drawnHeight / 2,
			// A hairline of overlap: adjacent strips that meet exactly still show a
			// seam once the destination width lands on a half pixel.
			spread + 1,
			drawnHeight
		);
	}
	ctx.restore();
}

export interface PassSceneSources {
	/** The live `metal-fx` ring, card-sized. Null until its first copy lands. */
	ring: HTMLCanvasElement | null;
	/**
	 * A copy of the ring taken at the loop's first frame, cross-dissolved back in
	 * over the last moments of the cycle. See `RING_FADE_SECONDS`.
	 */
	ringStill: HTMLCanvasElement | null;
	/** The live `warp` shader canvas, card-sized. Null until the mount is up. */
	warp: HTMLCanvasElement | null;
}

/**
 * What the card is printed ON, as a colours-only descriptor.
 *
 * Deliberately NOT an open painter interface. `composeFace` carries four
 * invariants that were each a bug first — the live card's stacking order, the
 * per-scheme shader opacity, the back face's mirroring, and the `roundRect` clip
 * that stops the metal ring exporting with square corners — and handing a
 * consumer the brush is handing it those four to get wrong again. A second kind
 * of card needs different COLOURS, so colours are all it gets.
 */
export interface PassBackdropSpec {
	/** Fed to the portalled `<ShaderBackground variant="warp">` by the studio. */
	colors: readonly string[];
	/** The iridescent foil's lit stop. Defaults to `palette.primary`. */
	foil?: string;
	/** Defaults to `WARP_OPACITY_DARK` / `WARP_OPACITY_LIGHT`. */
	opacity?: { dark: number; light: number };
	/**
	 * The two lit stops of the radial wash behind the card. Complete colour
	 * strings, alpha included — `BACKDROP_WASH_ALPHA` is the weight the waitlist
	 * card bakes in, and the third stop is always transparent.
	 */
	wash: readonly [string, string];
}

export interface PassSceneOptions {
	avatar?: CanvasImageSource | null;
	backdrop: PassBackdropSpec;
	/**
	 * The card's type layer. REQUIRED-STABLE: the scene is rebuilt whenever this
	 * identity changes, and rebuilding means awaiting the font, refetching the
	 * avatar and repainting three card-sized canvases.
	 */
	face: PassFacePainter;
	family: string;
	isDark: boolean;
	palette: PassPalette;
	/** Printed under the card so a re-share still points somewhere. */
	wordmark: string;
}

/**
 * A scene holds the two face bitmaps and the offscreen canvases they are
 * composited on. It is built once per set of facts and then asked for frames —
 * rebuilding the type layer 30 times a second would spend the whole budget on
 * text that never changes.
 */
export class PassScene {
	private readonly faceCanvas: HTMLCanvasElement;
	private readonly faceCtx: CanvasRenderingContext2D;
	private readonly frontType: HTMLCanvasElement;
	private readonly backType: HTMLCanvasElement;
	private readonly options: PassSceneOptions;
	/** Built lazily by `edgeSilhouette`; the geometry never changes. */
	private edgeCanvas: HTMLCanvasElement | null = null;

	constructor(options: PassSceneOptions) {
		this.options = options;
		const scale = FACE_SUPERSAMPLE;
		const width = CARD_WIDTH_PX * scale;
		const height = CARD_HEIGHT_PX * scale;

		this.faceCanvas = document.createElement("canvas");
		this.faceCanvas.width = width;
		this.faceCanvas.height = height;
		const faceCtx = this.faceCanvas.getContext("2d");
		if (!faceCtx) {
			throw new Error("Pass studio needs a 2D canvas context");
		}
		this.faceCtx = faceCtx;

		this.frontType = document.createElement("canvas");
		this.frontType.width = width;
		this.frontType.height = height;
		const frontCtx = this.frontType.getContext("2d");
		this.backType = document.createElement("canvas");
		this.backType.width = width;
		this.backType.height = height;
		const backCtx = this.backType.getContext("2d");
		if (!(frontCtx && backCtx)) {
			throw new Error("Pass studio needs a 2D canvas context");
		}
		const env: PassFaceEnv = {
			avatar: options.avatar,
			family: options.family,
			palette: options.palette,
			scale,
		};
		options.face.front(frontCtx, env);
		// `paintBackType` is the default rather than a branch inside the painter:
		// the back is the centred mark on every card there is, so a face that has
		// nothing to say about it should not have to say it.
		(options.face.back ?? paintBackType)(backCtx, env);
	}

	/**
	 * The card's outline, filled with the brushed-metal ramp — what its milled
	 * thickness looks like end-on. Built once and reused: it is a pure function of
	 * the card's geometry and does not move with the turn.
	 *
	 * Card-SHAPED rather than a rectangle, so that when it is projected half a
	 * thickness behind the visible face the two outlines agree at the corners.
	 */
	private edgeSilhouette(): HTMLCanvasElement {
		if (this.edgeCanvas) {
			return this.edgeCanvas;
		}
		const scale = FACE_SUPERSAMPLE;
		const rect = faceRect(scale);
		const canvas = document.createElement("canvas");
		canvas.width = CARD_WIDTH_PX * scale;
		canvas.height = CARD_HEIGHT_PX * scale;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			throw new Error("Pass studio needs a 2D canvas context");
		}
		// The card's ramp, READ FROM the shared stops rather than re-typed here.
		// This gradient used to be a hand-copied duplicate of `EDGE_METAL`, and
		// when the DOM ramp was retuned — from a symmetric bright/dark/bright sweep
		// to a single specular one, precisely because the dark band across the
		// middle made one card read as two joined at the waist — the copy stayed on
		// the old stops. Every exported still and loop therefore kept the exact
		// look the retune existed to remove, while the comment above them claimed
		// they were "the same ramp".
		const metal = ctx.createLinearGradient(0, 0, 0, canvas.height);
		for (const stop of EDGE_METAL_STOPS) {
			metal.addColorStop(stop.at / 100, stop.color);
		}
		ctx.fillStyle = metal;
		ctx.beginPath();
		ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.radius);
		ctx.fill();
		this.edgeCanvas = canvas;
		return canvas;
	}

	/**
	 * Composite one face at the current shader state.
	 *
	 * Order is the live card's own stacking order, top to bottom: the ring, the
	 * type, the foil, the warp, the card fill. Anything else and the shader sits
	 * over the name instead of under it.
	 */
	private composeFace(
		sources: PassSceneSources,
		side: "back" | "front",
		ringFade: number
	): HTMLCanvasElement {
		const ctx = this.faceCtx;
		const scale = FACE_SUPERSAMPLE;
		const rect = faceRect(scale);
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, this.faceCanvas.width, this.faceCanvas.height);

		// The card fill, inside the ring gutter.
		ctx.save();
		ctx.beginPath();
		ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.radius);
		ctx.clip();
		ctx.fillStyle = this.options.palette.card;
		ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

		// The warp shader, at the live card's own per-scheme opacity, mirrored on
		// the back so the pattern reads as the front's seen through the material.
		if (sources.warp && sources.warp.width > 0) {
			const opacity = this.options.backdrop.opacity;
			ctx.save();
			ctx.globalAlpha = this.options.isDark
				? (opacity?.dark ?? WARP_OPACITY_DARK)
				: (opacity?.light ?? WARP_OPACITY_LIGHT);
			if (side === "back") {
				ctx.translate(rect.x * 2 + rect.width, 0);
				ctx.scale(-1, 1);
			}
			ctx.drawImage(sources.warp, rect.x, rect.y, rect.width, rect.height);
			ctx.restore();
		}

		// Iridescent foil. `mix-blend-soft-light` has no canvas equivalent that
		// behaves the same over a shader, so it is drawn as `overlay` at the same
		// weight — the difference at 16% over a card face is under a level.
		const foil = ctx.createLinearGradient(
			rect.x,
			rect.y + rect.height,
			rect.x + rect.width * Math.cos((FOIL_ANGLE_DEG * Math.PI) / 180),
			rect.y
		);
		const lit = this.options.backdrop.foil ?? this.options.palette.primary;
		foil.addColorStop(0.24, "rgba(0,0,0,0)");
		foil.addColorStop(0.44, lit);
		foil.addColorStop(0.58, "rgba(0,0,0,0)");
		foil.addColorStop(0.74, lit);
		foil.addColorStop(0.88, "rgba(0,0,0,0)");
		ctx.save();
		ctx.globalCompositeOperation = "overlay";
		ctx.globalAlpha = FOIL_OPACITY;
		ctx.fillStyle = foil;
		ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
		ctx.restore();
		ctx.restore();

		ctx.drawImage(side === "front" ? this.frontType : this.backType, 0, 0);

		// The face's own hairline, UNDER the ring — the live card draws both
		// (`bg-card` plus `border` whenever it is ringed), and for a reason worth
		// keeping: the chromatic shader has genuinely dark passages, so in light
		// mode stretches of the ring read as no edge at all. The border is what the
		// card's outline falls back to there.
		ctx.save();
		ctx.strokeStyle = this.options.palette.border;
		ctx.lineWidth = scale;
		ctx.beginPath();
		ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.radius);
		ctx.stroke();
		ctx.restore();

		// The ring last, so it sits over the face's own edge exactly as the DOM
		// ring does. `metal-fx` composites onto a 2D canvas with the middle punched
		// out, so this is a straight copy of the band — but it MUST be clipped to
		// the card's corner radius on the way in.
		//
		// The library rounds its ring in CSS: the canvas ELEMENT carries
		// `border-radius: 28px`, while the pixels it holds are a square band (alpha
		// is 255 at 0,0 and 1,1). The browser does the rounding at paint time, so a
		// `drawImage` of the raw bitmap gets square corners — which is exactly how
		// the exported card ended up with a sharp-cornered ring around a rounded
		// face. Clipping here is what CSS was doing for the DOM card.
		const band = (image: HTMLCanvasElement, alpha: number) => {
			ctx.save();
			ctx.beginPath();
			ctx.roundRect(
				0,
				0,
				this.faceCanvas.width,
				this.faceCanvas.height,
				CARD_RADIUS_PX * scale
			);
			ctx.clip();
			ctx.globalAlpha = alpha;
			ctx.drawImage(image, 0, 0, this.faceCanvas.width, this.faceCanvas.height);
			ctx.restore();
		};
		const live = sources.ring && sources.ring.width > 0 ? sources.ring : null;
		const still =
			sources.ringStill && sources.ringStill.width > 0
				? sources.ringStill
				: null;
		if (live || still) {
			// Live underneath, the opening frame dissolved over the top as the cycle
			// closes. At `ringFade === 1` only the still remains, which is exactly
			// what the loop's first frame shows — so the wrap is a match rather than
			// a jump, without the band having been frozen to get there.
			if (live) {
				band(live, 1);
			}
			if (still && (ringFade > 0 || !live)) {
				band(still, live ? ringFade : 1);
			}
		} else {
			// No ring yet — the shared shader takes ~1.4s to develop a field. Widen
			// the hairline to the ring's own gutter so the card still has a defined
			// edge, rather than reading as unfinished for the first second.
			ctx.save();
			ctx.strokeStyle = this.options.palette.border;
			ctx.lineWidth = METAL_EDGE_RING_PX * scale;
			ctx.beginPath();
			ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.radius);
			ctx.stroke();
			ctx.restore();
		}
		return this.faceCanvas;
	}

	/**
	 * Draw one frame of the loop.
	 *
	 * `time` is seconds into the cycle. Everything that moves is periodic over
	 * `PASS_LOOP_SECONDS` — one revolution, two float cycles — so frame 0 and
	 * frame N are the same picture and the platform's own loop has no seam.
	 */
	render(
		ctx: CanvasRenderingContext2D,
		{
			format,
			sources,
			time,
		}: { format: PassFormat; sources: PassSceneSources; time: number }
	): void {
		const { height, width } = format;
		const cardHeight = height * format.cardFill;
		const cardWidth = cardHeight * (CARD_WIDTH_PX / CARD_HEIGHT_PX);
		const cardScale = cardHeight / CARD_HEIGHT_PX;
		const turn = (time / PASS_LOOP_SECONDS) * Math.PI * 2;
		// Two float cycles per loop, so the rise and fall closes with the turn.
		const floatPhase = (time / PASS_LOOP_SECONDS) * Math.PI * 4;
		const centerX = width / 2;
		const centerY =
			height / 2 + Math.sin(floatPhase) * FLOAT_TRAVEL_PX * cardScale;

		// Everything below is in FORMAT space. The caller owns the transform — the
		// preview sets a downscale on it so the same scene serves a 720px box and a
		// 1920px export — so resetting it here would draw the card at export
		// coordinates inside a preview-sized canvas, i.e. off the frame entirely.
		this.paintBackdrop(ctx, format);

		const cos = Math.cos(turn);
		const sin = Math.sin(turn);
		const front = cos >= 0;
		// Toward the end of the cycle the ring dissolves back to its opening frame.
		const ringFade =
			time > PASS_LOOP_SECONDS - RING_FADE_SECONDS
				? (time - (PASS_LOOP_SECONDS - RING_FADE_SECONDS)) / RING_FADE_SECONDS
				: 0;
		const face = this.composeFace(sources, front ? "front" : "back", ringFade);
		const perspective = PERSPECTIVE_PX * cardScale;
		const halfThickness = (CARD_THICKNESS_PX / 2) * cardScale;
		// The visible face sits half a thickness proud of the card's mid-plane;
		// the hidden one sits half a thickness behind it. Projecting both is what
		// puts a milled edge on the correct side of the turn.
		const nearW = front ? halfThickness : -halfThickness;
		const project = (u: number, w: number) => {
			const worldX = u * cos + w * sin;
			const worldZ = -u * sin + w * cos;
			const f = perspective / (perspective - worldZ);
			return { f, x: centerX + worldX * f };
		};

		this.paintShadow(ctx, {
			cardHeight,
			cardWidth,
			centerX,
			centerY,
			cos,
			height,
		});

		// The milled edge, drawn as the HIDDEN face's silhouette behind the visible
		// one, through the same projector — so it is the card's own rounded outline
		// offset by the thickness, not a rectangle behind it. A rectangle showed
		// through the visible face's rounded corners as a grey wedge, which is the
		// one place the two silhouettes disagree. A full slice stack (what the DOM
		// card builds) is invisible at this size; the band is a few pixels either way.
		projectFace(ctx, this.edgeSilhouette(), {
			cardHeight,
			cardWidth,
			centerY,
			mirrored: false,
			plane: -nearW,
			project,
		});

		// The visible face. Mirrored for the back, which is the same sheet seen from
		// behind rather than a second card glued on.
		projectFace(ctx, face, {
			cardHeight,
			cardWidth,
			centerY,
			mirrored: !front,
			plane: nearW,
			project,
		});

		this.paintSweep(ctx, {
			cardHeight,
			cardWidth,
			centerX,
			centerY,
			cos,
			turn,
		});
		this.paintFooter(ctx, format, time);
	}

	/** The frame the card sits in: the page colour, washed with the card's own. */
	private paintBackdrop(
		ctx: CanvasRenderingContext2D,
		format: PassFormat
	): void {
		const { height, width } = format;
		ctx.fillStyle = this.options.isDark ? "#08080a" : "#f6f6f8";
		ctx.fillRect(0, 0, width, height);
		const wash = ctx.createRadialGradient(
			width / 2,
			height * 0.42,
			0,
			width / 2,
			height * 0.42,
			Math.max(width, height) * 0.62
		);
		const [near, far] = this.options.backdrop.wash;
		wash.addColorStop(0, near);
		wash.addColorStop(0.55, far);
		wash.addColorStop(1, "hsla(0, 0%, 0%, 0)");
		ctx.fillStyle = wash;
		ctx.fillRect(0, 0, width, height);
	}

	/** A cast shadow that narrows as the card turns edge-on, because it must. */
	private paintShadow(
		ctx: CanvasRenderingContext2D,
		{
			cardHeight,
			cardWidth,
			centerX,
			centerY,
			cos,
			height,
		}: {
			cardHeight: number;
			cardWidth: number;
			centerX: number;
			centerY: number;
			cos: number;
			height: number;
		}
	): void {
		const radiusX = (cardWidth / 2) * Math.max(0.18, Math.abs(cos));
		const radiusY = cardHeight * 0.05;
		const y = centerY + cardHeight / 2 + height * 0.02;
		ctx.save();
		ctx.filter = `blur(${cardHeight * SHADOW_BLUR_RATIO}px)`;
		ctx.fillStyle = `rgba(0, 0, 0, ${SHADOW_ALPHA})`;
		ctx.beginPath();
		ctx.ellipse(centerX, y, radiusX, radiusY, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}

	/** A specular graze travelling with the turn, so the face reads as laminated. */
	private paintSweep(
		ctx: CanvasRenderingContext2D,
		{
			cardHeight,
			cardWidth,
			centerX,
			centerY,
			cos,
			turn,
		}: {
			cardHeight: number;
			cardWidth: number;
			centerX: number;
			centerY: number;
			cos: number;
			turn: number;
		}
	): void {
		const facing = Math.abs(cos);
		if (facing < 0.15) {
			return;
		}
		const half = (cardWidth / 2) * facing;
		const offset = Math.sin(turn * 2) * half;
		const sweep = ctx.createLinearGradient(
			centerX + offset - half * 0.6,
			centerY - cardHeight / 2,
			centerX + offset + half * 0.6,
			centerY + cardHeight / 2
		);
		sweep.addColorStop(0, "rgba(255,255,255,0)");
		sweep.addColorStop(0.5, `rgba(255,255,255,${SWEEP_OPACITY * facing})`);
		sweep.addColorStop(1, "rgba(255,255,255,0)");
		ctx.save();
		ctx.globalCompositeOperation = "soft-light";
		ctx.fillStyle = sweep;
		ctx.fillRect(
			centerX - half,
			centerY - cardHeight / 2,
			half * 2,
			cardHeight
		);
		ctx.restore();
	}

	/** Mark plus host, under the card. A shared asset with no address is a dead end. */
	private paintFooter(
		ctx: CanvasRenderingContext2D,
		format: PassFormat,
		time: number
	): void {
		const short = Math.min(format.width, format.height);
		const mark = short * FOOTER_MARK_RATIO;
		const gap = short * FOOTER_GAP_RATIO;
		const baseline = format.height - short * FOOTER_MARGIN_RATIO;
		const color = this.options.palette.mutedForeground;
		ctx.save();
		ctx.font = `500 ${mark * 0.78}px ${this.options.family}`;
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		const label = this.options.wordmark;
		const labelWidth = ctx.measureText(label).width;
		const totalWidth = mark + gap + labelWidth;
		const startX = (format.width - totalWidth) / 2;
		ctx.globalAlpha = 0.75;
		// The LIVE mark, not the resting one: it blinks and its gaze drifts, the
		// same two behaviours `logo.tsx` runs. The card's own marks stay still
		// because the card's `variant="outline"` Logo is drawn at rest — this is
		// the one place in the frame where the ghost is alive.
		drawGhost(ctx, {
			color,
			eyes: ghostEyesAt(time, PASS_LOOP_SECONDS),
			scale: 1,
			size: mark,
			x: startX,
			y: baseline - mark * 0.82,
		});
		ctx.fillStyle = color;
		ctx.fillText(label, startX + mark + gap, baseline);
		ctx.restore();
	}
}
