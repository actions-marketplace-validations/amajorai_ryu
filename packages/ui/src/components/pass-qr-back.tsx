"use client";

import { passQrColors } from "../lib/pass-qr.ts";
import { cn } from "../lib/utils.ts";
import { ditherAvatarHue } from "./dither-kit/avatar.tsx";
import { Logo } from "./logo.tsx";
import { useIsDarkFace } from "./pass-card-shell.tsx";
import { QRCode } from "./qr-code.tsx";

const QR_SIZE = 224;

export interface PassQrBackProps {
	/** The small instruction beneath the code. */
	caption: string;
	className?: string;
	metalTheme?: "auto" | "dark" | "light";
	/** The same public seed that paints the card's warp field. */
	seed: string;
	/** The absolute URL a phone camera should open. */
	value?: string | null;
}

/**
 * The shared back face for invite-bearing passes.
 *
 * QR modules stay dot-shaped so they feel native to Ryu's dither language. The
 * face tint is derived from the card seed, while the foreground is pulled back
 * toward the semantic foreground so the code remains camera-readable. High QR
 * correction leaves a small quiet-zone cutout for the static Ryu mark in the
 * middle without turning the logo into a second visual block.
 */
export function PassQrBack({
	caption,
	className,
	metalTheme = "auto",
	seed,
	value,
}: PassQrBackProps) {
	const isDark = useIsDarkFace(metalTheme);
	const colors = passQrColors(ditherAvatarHue(seed), isDark);
	const trimmedValue = value?.trim() ?? "";

	return (
		<div
			className={cn(
				"relative flex h-full min-h-[27rem] w-full flex-col items-center justify-center gap-3 p-7",
				className
			)}
		>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-14 rounded-full blur-3xl"
				style={{
					background: `radial-gradient(circle, ${colors.glow}, transparent 70%)`,
				}}
			/>
			{trimmedValue ? (
				<>
					<div
						className="relative rounded-[1.65rem] p-3.5"
						style={{
							backgroundColor: colors.surface,
							boxShadow: `0 0 0 1px ${colors.glow}, 0 18px 45px -28px ${colors.glow}`,
						}}
					>
						<QRCode
							aria-label={caption}
							bgColor={colors.surface}
							className="size-[13rem]"
							errorCorrectionLevel="H"
							fgColor={colors.foreground}
							size={QR_SIZE}
							value={trimmedValue}
						/>
						<div
							aria-hidden="true"
							className="absolute top-1/2 left-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl"
							style={{
								backgroundColor: colors.surface,
								boxShadow: `0 0 0 3px ${colors.surface}`,
							}}
						>
							<span style={{ color: colors.foreground }}>
								<Logo size="25px" variant="outline-static" />
							</span>
						</div>
					</div>
					<span
						className="font-medium text-[10px] uppercase tracking-[0.24em]"
						style={{ color: colors.foreground }}
					>
						{caption}
					</span>
				</>
			) : (
				<div
					className="relative flex size-[13rem] flex-col items-center justify-center gap-2 rounded-[1.65rem] border border-dashed text-center"
					style={{
						backgroundColor: colors.surface,
						borderColor: colors.glow,
						color: colors.foreground,
					}}
				>
					<span className="font-mono text-2xl tracking-[0.35em]">···</span>
					<span className="max-w-36 text-[10px] uppercase tracking-[0.18em] opacity-70">
						Invite link is preparing
					</span>
				</div>
			)}
		</div>
	);
}
