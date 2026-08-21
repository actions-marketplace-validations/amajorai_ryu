/**
 * The frames a pass can be exported into, and the card's geometry inside them.
 *
 * One list, two consumers — the still and the loop are the SAME scene rendered
 * at the same sizes, so a member who picks 9:16 gets a picture and a video that
 * crop identically. Splitting them would guarantee the two drift the first time
 * one gained a ratio.
 *
 * Sizes are the ones each network actually re-encodes to, so nothing is scaled
 * twice: 1080 on the short edge everywhere, which is the ceiling X, Instagram
 * and LinkedIn all accept without resampling.
 */

export interface PassFormat {
	/**
	 * The card's height as a fraction of the frame's HEIGHT.
	 *
	 * Height rather than the short edge, which is what this measured first: on
	 * 9:16 the short edge is the WIDTH, so a card sized against it came out at 29%
	 * of a story frame — a stamp floating in a tall empty field. Measuring the
	 * card's height against the frame's height is the thing a reader actually
	 * judges, and it is per-format because a tall frame wants proportionally less
	 * of it than a wide one (the margins above and below have to stay clear of
	 * story chrome).
	 */
	cardFill: number;
	height: number;
	/** Stable key — also the filename suffix, so `ryu-pass-9x16.mp4`. */
	id: PassFormatId;
	/** What the ratio is FOR, in the picker. Not the ratio itself. */
	label: string;
	/** The ratio as written, e.g. "9:16". */
	ratio: string;
	width: number;
}

export type PassFormatId =
	| "portrait"
	| "landscape"
	| "square"
	| "feed"
	| "post";

export const PASS_FORMATS: readonly PassFormat[] = [
	{
		cardFill: 0.46,
		height: 1920,
		id: "portrait",
		label: "Stories, Reels, TikTok",
		ratio: "9:16",
		width: 1080,
	},
	{
		cardFill: 0.54,
		height: 1350,
		id: "feed",
		label: "Instagram feed",
		ratio: "4:5",
		width: 1080,
	},
	{
		cardFill: 0.56,
		height: 1440,
		id: "post",
		label: "Instagram post",
		ratio: "3:4",
		width: 1080,
	},
	{
		cardFill: 0.66,
		height: 1080,
		id: "square",
		label: "LinkedIn, Threads",
		ratio: "1:1",
		width: 1080,
	},
	{
		cardFill: 0.72,
		height: 1080,
		id: "landscape",
		label: "X, YouTube",
		ratio: "16:9",
		width: 1920,
	},
] as const;

/** The default: the ratio the old dialog produced, so nothing regresses. */
export const DEFAULT_PASS_FORMAT_ID: PassFormatId = "landscape";

export const passFormat = (id: PassFormatId): PassFormat =>
	PASS_FORMATS.find((format) => format.id === id) ??
	PASS_FORMATS.find((format) => format.id === DEFAULT_PASS_FORMAT_ID) ??
	PASS_FORMATS[0]!;

/**
 * The loop's period, in seconds. One unbroken revolution per cycle, so the
 * video's last frame is its first and the platform's own infinite loop has no
 * seam to show. Ten because that is the longest a timeline autoplays a muted
 * clip before a viewer scrolls, and the shortest that reads as deliberate
 * rather than as a GIF.
 */
export const PASS_LOOP_SECONDS = 10;
/**
 * 60, not 30.
 *
 * The reasoning for 30 was that a slowly turning card hides a low frame rate.
 * It does not: a slow, continuous rotation is the WORST case for 30fps, because
 * every frame steps the same small angle and the eye tracks the edge across each
 * step. At 60 the same turn reads as motion rather than as a sequence.
 *
 * It costs twice the frames, which the bitrate below accounts for. It does not
 * cost correctness on a machine that cannot keep up: frames are indexed rather
 * than timed (see `record.ts`), so a slow machine draws fewer distinct frames of
 * the same complete cycle instead of ending the loop early.
 */
export const PASS_LOOP_FPS = 60;
