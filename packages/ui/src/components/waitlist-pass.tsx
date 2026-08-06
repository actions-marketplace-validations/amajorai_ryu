"use client";

import { MetalFx } from "metal-fx";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar.tsx";

/**
 * The membership pass a queued user sees on the waitlist screens (web
 * `waitlist-view.tsx` and desktop `WaitlistPage.tsx`). One definition, two
 * consumers — the card is what makes the queue feel like a club rather than a
 * form, so it must look identical everywhere it appears.
 *
 * Presentational and side-effect free: it takes the already-resolved queue facts
 * and renders them. All colour comes from design tokens so it reads correctly in
 * light and dark, exactly like `employee-badge.tsx`, whose laminated-ID language
 * (lanyard notch, accent bar, mono serial, stats footer) this deliberately
 * mirrors.
 *
 * Motion: a mouse-tracked 3D tilt with a specular glare on hover, and a slow
 * continuous sway when idle so the card never sits flat. Both are suppressed
 * under `prefers-reduced-motion` — the pass is decoration, and decoration is the
 * first thing that should stop moving when a user asks for less of it.
 *
 * The border is `metal-fx` (the same shader the onboarding "Use Ryu Cloud"
 * button wears), which paints an animated metallic ring around whatever it
 * wraps. It sits INSIDE the rotating element rather than around it: the ring is
 * a canvas positioned over the measured child, so it only travels with the sway
 * when a common ancestor carries the transform.
 */

/** Below this position a member is "founding" rather than merely early. */
const FOUNDING_POSITION_CUTOFF = 100;
/** Degrees of tilt at the far edge of the card while pointing at it. */
const TILT_DEGREES = 14;
/** Degrees of idle sway, and how long one full cycle takes. */
const IDLE_ROTATE_Y = 7;
const IDLE_ROTATE_X = 3;
const IDLE_CYCLE_SECONDS = 9;
/** Half of the coordinate space; a pointer at the centre must read as zero tilt. */
const CENTER = 0.5;
/** Tilt is derived from a -50..50 offset, so halve the span to normalize it. */
const TILT_SPAN = 50;
const SERIAL_LENGTH = 6;
/** Bars in the decorative barcode strip, and the x-pitch between them. */
const BARCODE_BARS = 60;
const BARCODE_PITCH = 3.3;
const BARCODE_MAX_WIDTH = 3;
const MAX_INITIALS = 2;
const WHITESPACE = /\s+/;
const NON_ALPHANUMERIC = /[^a-zA-Z0-9]/g;

/**
 * Metal ring geometry. `metal-fx` ships only `button` (134×40 baseline, 1px
 * ring, shaderScale 1.6) and `circle` variants — there is no card variant, and
 * the button defaults read as a hairline with pill-sized pattern features when
 * stretched over a surface this large. So the ring is widened and the shader
 * zoomed out, and the radius is passed explicitly rather than left to be read
 * back off the computed style.
 */
const CARD_RADIUS_PX = 28;
const METAL_RING_PX = 3;
const METAL_SHADER_SCALE = 0.75;
const METAL_STRENGTH = 0.9;

export interface WaitlistPassProps {
	avatarUrl?: string | null;
	className?: string;
	/** Sign-up time (ISO). Rendered as the "member since" date. */
	joinedAt?: string | null;
	/**
	 * Which tuning of the metal ring to paint. `"auto"` follows
	 * `prefers-color-scheme`, which is wrong wherever the app has a manual theme
	 * toggle that can disagree with the OS — both waitlist screens pass their
	 * resolved theme instead. Kept as a prop rather than read from `next-themes`
	 * here so the UI package stays consumer-agnostic.
	 */
	metalTheme?: "auto" | "dark" | "light";
	/** Display name on the pass. Falls back to the handle, then to "Member". */
	name?: string | null;
	/** 1-based queue position; null while it is still loading or unknown. */
	position?: number | null;
	referralCount?: number;
	/** Stable id the serial number is derived from (user id, referral code, …). */
	serialSeed?: string | null;
	totalWaiting?: number | null;
	/** Reserved handle, without the leading "@". */
	username?: string | null;
}

/** Two-letter uppercase initials for the avatar fallback. */
const passInitials = (name: string): string => {
	const parts = name.trim().split(WHITESPACE).filter(Boolean);
	if (parts.length === 0) {
		return "?";
	}
	return parts
		.slice(0, MAX_INITIALS)
		.map((part) => part.charAt(0).toUpperCase())
		.join("");
};

/** A stable, human-readable pass serial like "RYU-A1B2C3". */
export const formatPassSerial = (seed: string | null | undefined): string => {
	const compact = (seed ?? "").replace(NON_ALPHANUMERIC, "").toUpperCase();
	return `RYU-${(compact || "000000").slice(0, SERIAL_LENGTH).padEnd(SERIAL_LENGTH, "0")}`;
};

/** "Jan 5, 2026" from an ISO stamp; null for missing or unparseable input. */
export const formatPassDate = (
	iso: string | null | undefined
): string | null => {
	if (!iso) {
		return null;
	}
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return null;
	}
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
};

/**
 * Bar geometry for the decorative barcode, derived from the serial so a given
 * pass always draws the same bars. A strip that reshuffled on every render would
 * read as noise rather than as an identifier.
 */
const barcodeBars = (serial: string): { width: number; x: number }[] =>
	Array.from({ length: BARCODE_BARS }, (_, index) => ({
		width:
			((serial.charCodeAt(index % serial.length) + index) % BARCODE_MAX_WIDTH) +
			1,
		x: index * BARCODE_PITCH,
	}));

/** The tier label a position earns. Early numbers are the whole point. */
export const passTierLabel = (position: number | null | undefined): string =>
	typeof position === "number" && position <= FOUNDING_POSITION_CUTOFF
		? "Founding member"
		: "Early access";

/**
 * An x.com compose URL. Used by both waitlist screens for the share action; the
 * caller decides how to open it (a browser `window.open`, or the desktop's
 * `openExternal`, which must not navigate the app window away).
 */
export const xShareIntentUrl = (text: string, url?: string | null): string => {
	const params = new URLSearchParams({ text });
	if (url) {
		params.set("url", url);
	}
	return `https://x.com/intent/tweet?${params.toString()}`;
};

/** The share copy, kept next to the intent helper so both screens say the same thing. */
export const waitlistShareText = (
	position: number | null | undefined
): string =>
	typeof position === "number"
		? `I just claimed spot #${position} on the Ryu waitlist.`
		: "I just claimed my spot on the Ryu waitlist.";

export function WaitlistPass({
	avatarUrl,
	className,
	joinedAt,
	metalTheme = "auto",
	name,
	position,
	referralCount = 0,
	serialSeed,
	totalWaiting,
	username,
}: WaitlistPassProps) {
	const reduceMotion = useReducedMotion();
	const cardRef = useRef<HTMLDivElement>(null);
	const [hovered, setHovered] = useState(false);
	const [tilt, setTilt] = useState({ x: 0, y: 0 });
	const [glare, setGlare] = useState({ x: 50, y: 50 });

	const handlePointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const node = cardRef.current;
			if (!node) {
				return;
			}
			const rect = node.getBoundingClientRect();
			const offsetX = ((event.clientX - rect.left) / rect.width - CENTER) * 100;
			const offsetY = ((event.clientY - rect.top) / rect.height - CENTER) * 100;
			setGlare({ x: offsetX / 2 + 50, y: offsetY / 2 + 50 });
			setTilt({
				x: -(offsetY / TILT_SPAN) * TILT_DEGREES,
				y: (offsetX / TILT_SPAN) * TILT_DEGREES,
			});
		},
		[]
	);

	const handlePointerLeave = useCallback(() => {
		setHovered(false);
		setTilt({ x: 0, y: 0 });
		setGlare({ x: 50, y: 50 });
	}, []);

	// Idle sway vs. pointer-driven tilt. Framer animates between the two shapes
	// directly: the array form is the keyframed loop, the scalar form the tracked
	// angle, and swapping between them on hover is what makes the card "settle"
	// into the pointer instead of fighting the loop.
	const idle = !(hovered || reduceMotion);
	const animate = idle
		? {
				rotateX: [0, IDLE_ROTATE_X, 0, -IDLE_ROTATE_X, 0],
				rotateY: [0, -IDLE_ROTATE_Y, 0, IDLE_ROTATE_Y, 0],
				scale: 1,
			}
		: {
				rotateX: reduceMotion ? 0 : tilt.x,
				rotateY: reduceMotion ? 0 : tilt.y,
				scale: hovered && !reduceMotion ? 1.03 : 1,
			};
	const transition = idle
		? {
				duration: IDLE_CYCLE_SECONDS,
				ease: "easeInOut" as const,
				repeat: Number.POSITIVE_INFINITY,
			}
		: { duration: 0.25, ease: "easeOut" as const };

	const displayName = name?.trim() || (username ? `@${username}` : "Member");
	const memberSince = formatPassDate(joinedAt);
	const serial = formatPassSerial(serialSeed ?? username ?? name);
	const tier = passTierLabel(position);
	const bars = useMemo(() => barcodeBars(serial), [serial]);

	return (
		<div
			className={cn("w-full [perspective:1200px]", className)}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={handlePointerLeave}
			onPointerMove={handlePointerMove}
			ref={cardRef}
		>
			{/* The transform lives on this wrapper, one level above the metal ring,
			    so the canvas MetalFx paints over its child travels with the sway
			    instead of sitting flat behind a tilting card. */}
			<motion.div
				animate={animate}
				className="rounded-[1.75rem] shadow-xl"
				transition={transition}
			>
				<MetalFx
					borderRadius={CARD_RADIUS_PX}
					// The wandering halo is tuned for a pill-sized button. Over a surface
					// this large it stops reading as a glow around an edge and becomes a
					// blue wash across the whole card face, desaturating the content. The
					// shader ring — the part that is actually the border — still renders.
					disableGlow
					// A paused instance still gets one frame painted (metal-fx keeps the
					// last copy), so reduced motion gets a static metallic ring rather
					// than a blank canvas.
					paused={Boolean(reduceMotion)}
					preset="chromatic"
					ringCssPx={METAL_RING_PX}
					shaderScale={METAL_SHADER_SCALE}
					strength={METAL_STRENGTH}
					theme={metalTheme}
					variant="button"
				>
					{/* No `transform-style: preserve-3d` anywhere on this subtree,
					    deliberately: Chromium forces it back to `flat` whenever the same
					    element also has `overflow: hidden`, and the clip is what keeps
					    the square accent bar inside the rounded corners while the card is
					    tilted. Nothing here is positioned in depth, so the perspective on
					    the outer wrapper is the only 3D this needs. */}
					{/* `isolate` scopes the foil overlay's `mix-blend-soft-light` to the
					    card, so it can never blend against whatever the card happens to
					    be sitting on. */}
					<div className="relative isolate overflow-hidden rounded-[1.75rem] border bg-card text-card-foreground">
						{/* Lanyard slot + accent bar, the same laminated-ID language as
				    employee-badge.tsx. */}
						<div
							aria-hidden="true"
							className="relative h-2.5 w-full"
							style={{ backgroundColor: "var(--primary)" }}
						>
							<span className="absolute top-1 left-1/2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-card ring-1 ring-border" />
						</div>

						{/* Iridescent foil: a fixed diagonal sheen so the card reads as
					    laminated even when nothing is pointing at it. Deliberately faint.
					    Measured over a white card face, the original weighting pulled the
					    centre to rgb(200,233,255) — a blue wash rather than a graze, which
					    desaturated the content sitting on it. The metal ring now carries
					    most of the laminated signal, so this only has to hint at it. */}
						<div
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 opacity-[0.16] mix-blend-soft-light"
							style={{
								background:
									"linear-gradient(115deg, transparent 24%, color-mix(in oklab, var(--primary) 32%, transparent) 44%, transparent 58%, color-mix(in oklab, var(--primary) 18%, transparent) 74%, transparent 88%)",
							}}
						/>

						<div className="relative flex flex-col gap-5 p-6">
							<div className="flex items-start justify-between gap-3">
								<span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-medium text-[10px] text-primary uppercase tracking-[0.14em]">
									{tier}
								</span>
								<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
									{serial}
								</span>
							</div>

							<div className="flex items-center gap-3">
								<Avatar className="size-14 ring-1 ring-border" size="lg">
									{avatarUrl ? (
										<AvatarImage alt={displayName} src={avatarUrl} />
									) : null}
									<AvatarFallback className="font-semibold text-base">
										{passInitials(displayName)}
									</AvatarFallback>
								</Avatar>
								<div className="flex min-w-0 flex-col">
									<span className="truncate font-semibold text-lg leading-tight">
										{displayName}
									</span>
									<span className="truncate font-mono text-muted-foreground text-xs">
										{username ? `@${username}` : "handle not reserved"}
									</span>
								</div>
							</div>

							<div className="flex items-end justify-between gap-3 border-t pt-5">
								<div className="flex flex-col">
									<span className="text-[10px] text-muted-foreground uppercase tracking-[0.14em]">
										Position
									</span>
									<span className="font-bold text-5xl tabular-nums leading-none">
										#{position ?? "—"}
									</span>
								</div>
								<div className="flex flex-col items-end gap-2 text-right">
									<div className="flex flex-col">
										<span className="text-[10px] text-muted-foreground uppercase tracking-[0.14em]">
											Member since
										</span>
										<span className="font-medium text-sm tabular-nums">
											{memberSince ?? "—"}
										</span>
									</div>
									<div className="flex flex-col">
										<span className="text-[10px] text-muted-foreground uppercase tracking-[0.14em]">
											Referrals
										</span>
										<span className="font-medium text-sm tabular-nums">
											{referralCount}
										</span>
									</div>
								</div>
							</div>

							<div className="flex flex-col gap-2 border-t pt-4">
								<svg
									aria-hidden="true"
									className="h-8 w-full text-foreground/70"
									preserveAspectRatio="none"
									role="presentation"
									viewBox="0 0 200 32"
								>
									{bars.map((bar) => (
										<rect
											fill="currentColor"
											height="32"
											key={bar.x}
											width={bar.width}
											x={bar.x}
										/>
									))}
								</svg>
								<div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground uppercase tracking-[0.14em]">
									<span>Ryu early access</span>
									<span className="tabular-nums">
										{typeof totalWaiting === "number"
											? `of ${totalWaiting.toLocaleString()}`
											: ""}
									</span>
								</div>
							</div>
						</div>

						{/* Specular glare, tracked to the pointer. Fades out on leave rather
				    than snapping, so the highlight follows the hand off the card. */}
						<motion.div
							animate={{ opacity: hovered && !reduceMotion ? 1 : 0 }}
							aria-hidden="true"
							className="pointer-events-none absolute inset-0"
							style={{
								background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 62%)`,
							}}
							transition={{ duration: 0.25 }}
						/>
					</div>
				</MetalFx>
			</motion.div>
		</div>
	);
}
