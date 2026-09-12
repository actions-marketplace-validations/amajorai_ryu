"use client";

import {
	DitherGradient,
	type GradientDirection,
} from "@ryu/ui/components/dither-kit/gradient.tsx";
import {
	type DitherColor,
	isDitherColor,
} from "@ryu/ui/components/dither-kit/palette.ts";
import type { ExpressiveAnimationSelection } from "@ryu/ui/components/expressive-animation.ts";
import {
	dicebearUrl,
	type GlyphDitherValue,
	type GlyphValue,
} from "@ryu/ui/components/glyph.ts";
import { Icon } from "@ryu/ui/components/icon.tsx";
import { Logo } from "@ryu/ui/components/logo";
import { cn } from "@ryu/ui/lib/utils.ts";
import type { ReactNode } from "react";
import {
	AVATAR_CONVERSATION_POSES,
	type AvatarConversationState,
	useAvatarConversationState,
} from "./avatar-conversation.tsx";

const DITHER_DIRECTIONS: GradientDirection[] = ["up", "down", "left", "right"];

function resolveDither(dither: GlyphDitherValue): {
	from: DitherColor;
	to: DitherColor | "transparent";
	direction: GradientDirection;
} {
	const from: DitherColor = isDitherColor(dither.from) ? dither.from : "grey";
	const to: DitherColor | "transparent" = isDitherColor(dither.to)
		? dither.to
		: "transparent";
	const direction: GradientDirection =
		DITHER_DIRECTIONS.find((d) => d === dither.direction) ?? "up";
	return { from, to, direction };
}

/** Full-bleed dither layer for use behind an icon/emoji foreground. */
function DitherBackdrop({ dither }: { dither: GlyphDitherValue }) {
	const { from, to, direction } = resolveDither(dither);
	return (
		<span aria-hidden className="absolute inset-0 overflow-hidden">
			<DitherGradient direction={direction} from={from} to={to} />
		</span>
	);
}

/**
 * Render any {@link GlyphValue}. Hosts pass a `fallback` for the null / empty
 * case (engine logo, folder icon, etc.). Icons and emojis may include an
 * optional dither background; DiceBear, expressive ghosts, and uploads never do.
 */
export function GlyphDisplay({
	value,
	fallback,
	size = 16,
	className,
	alt = "",
	animated = true,
	animation,
	thinking = false,
	conversationState,
}: {
	/** Accessible alt for image-like glyphs; decorative when empty. */
	alt?: string;
	/** Override the animation for an expressive glyph at render time. */
	animation?: ExpressiveAnimationSelection;
	/** Disable expression cycling and gaze/blink motion for dense picker previews. */
	animated?: boolean;
	className?: string;
	fallback?: ReactNode;
	/** Square footprint in px (font-size for emoji, Icon size, img box). */
	size?: number;
	/** Runtime working state; expressive ghosts use the orbit animation to think. */
	thinking?: boolean;
	conversationState?: AvatarConversationState;
	value: GlyphValue;
}) {
	const contextState = useAvatarConversationState();
	if (value?.kind === "avatar") {
		return (
			// biome-ignore lint/performance/noImgElement: shared UI package; glyph is an inline data URL or remote image
			// biome-ignore lint/correctness/useImageSize: sized via inline width/height
			<img
				alt={alt}
				className={cn("shrink-0 object-cover", className)}
				draggable={false}
				src={value.dataUrl}
				style={{ width: size, height: size }}
			/>
		);
	}
	if (value?.kind === "emoji") {
		return (
			<span
				aria-hidden={alt ? undefined : true}
				aria-label={alt || undefined}
				className={cn(
					"relative flex shrink-0 items-center justify-center overflow-hidden leading-none",
					className
				)}
				role={alt ? "img" : undefined}
				style={{ width: size, height: size, fontSize: size * 0.72 }}
			>
				{value.dither ? <DitherBackdrop dither={value.dither} /> : null}
				<span className="relative z-10">{value.emoji}</span>
			</span>
		);
	}
	if (value?.kind === "icon") {
		return (
			<span
				className={cn(
					"relative flex shrink-0 items-center justify-center overflow-hidden",
					className
				)}
				style={{
					width: size,
					height: size,
					color: value.color,
				}}
			>
				{value.dither ? <DitherBackdrop dither={value.dither} /> : null}
				<span className="relative z-10 flex items-center justify-center">
					<Icon icon={value.id} label={alt || undefined} size={size * 0.55} />
				</span>
			</span>
		);
	}
	if (value?.kind === "dicebear") {
		return (
			// biome-ignore lint/performance/noImgElement: DiceBear SVG served over HTTPS / data
			// biome-ignore lint/correctness/useImageSize: sized via inline width/height
			<img
				alt={alt}
				className={cn("shrink-0 object-cover", className)}
				draggable={false}
				src={dicebearUrl(value.style, value.seed, { size })}
				style={{ width: size, height: size }}
			/>
		);
	}
	if (value?.kind === "expressive") {
		const reactive = value.behavior === "conversation";
		const activity =
			conversationState ?? (thinking ? "thinking" : contextState);
		const pose = reactive
			? AVATAR_CONVERSATION_POSES[activity]
			: {
					expression: value.expression,
					animation: thinking
						? ("orbit" as const)
						: (animation ?? value.animation),
				};
		const variant = value.variant ?? "expressive";
		const motion = animated && value.animated !== false;
		const logoProps = {
			animated: motion,
			animation: pose.animation,
			expression: pose.expression,
			eyeScale: value.eyeScale,
			animationDuration: value.animationDuration,
			colors: value.colors,
			size: `${size}px`,
		};
		return (
			<span
				aria-hidden={alt ? undefined : true}
				aria-label={alt || undefined}
				className={cn("relative inline-flex shrink-0", className)}
				data-avatar-behavior={value.behavior ?? "custom"}
				data-avatar-state={reactive ? activity : undefined}
				role={alt ? "img" : undefined}
				style={{
					width: size,
					height: size,
					color:
						variant === "default" || variant === "3d"
							? undefined
							: value.colors?.c1,
					...(value.colors?.c1
						? { "--muted-foreground": value.colors.c1 }
						: {}),
				}}
			>
				{variant === "default" ? (
					<>
						<Logo {...logoProps} showEyes={false} variant="default" />
						<span className="absolute inset-0">
							<Logo {...logoProps} variant="expressive" />
						</span>
					</>
				) : (
					<span inert={variant === "3d"}>
						<Logo
							{...logoProps}
							bodyStyle={value.bodyStyle ?? "orb"}
							variant={variant === "outline" ? "expressive" : variant}
						/>
					</span>
				)}
			</span>
		);
	}

	if (value?.kind === "dither") {
		const { from, to, direction } = resolveDither(value.dither);
		return (
			<span
				aria-hidden={alt ? undefined : true}
				aria-label={alt || undefined}
				className={cn(
					"relative inline-block shrink-0 overflow-hidden",
					className
				)}
				role={alt ? "img" : undefined}
				style={{ width: size, height: size }}
			>
				<DitherGradient direction={direction} from={from} to={to} />
			</span>
		);
	}
	return <>{fallback}</>;
}
