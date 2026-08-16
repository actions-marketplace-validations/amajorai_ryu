"use client";

import { Button } from "@ryu/ui/components/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@ryu/ui/components/dialog.tsx";
import {
	createQRCodeGeometry,
	type ErrorCorrectionLevel,
} from "@ryu/ui/lib/qr-code.ts";
import { cn } from "@ryu/ui/lib/utils.ts";
import { Maximize2 } from "lucide-react";
import { type SVGProps, useMemo, useState } from "react";

const DEFAULT_SIZE = 268;
const EXPANDED_SIZE = 720;

interface QRCodeProps extends SVGProps<SVGSVGElement> {
	bgColor?: string;
	errorCorrectionLevel?: ErrorCorrectionLevel;
	fgColor?: string;
	size?: number;
	value: string;
}

interface ExpandableQRCodeProps extends QRCodeProps {
	containerClassName?: string;
	expandLabel?: string;
}

/**
 * Spell UI's rounded, dot-style QR renderer, adapted to the shared Ryu UI
 * package so every web-based surface uses one implementation.
 */
function QRCode({
	value,
	size = DEFAULT_SIZE,
	fgColor = "var(--foreground)",
	bgColor = "var(--background)",
	errorCorrectionLevel = "M",
	className,
	"aria-label": ariaLabel = "QR code",
	...props
}: QRCodeProps) {
	const geometry = useMemo(
		() => createQRCodeGeometry(value, size, errorCorrectionLevel),
		[errorCorrectionLevel, size, value]
	);

	if (!geometry) {
		return null;
	}

	const {
		circleRadius,
		circles,
		finderPositions,
		finderSize,
		innerBlackSize,
		innerPadding,
		innerWhiteSize,
		moduleSize,
	} = geometry;

	return (
		<svg
			aria-label={ariaLabel}
			className={cn("block", className)}
			height={size}
			role="img"
			viewBox={`0 0 ${size} ${size}`}
			width={size}
			xmlns="http://www.w3.org/2000/svg"
			{...props}
		>
			<rect fill={bgColor} height={size} rx="12" ry="12" width={size} />
			{finderPositions.map(([row, column]) => {
				const x = column * moduleSize;
				const y = row * moduleSize;
				return (
					<g key={`${row}-${column}`}>
						<rect
							fill={fgColor}
							height={finderSize}
							rx="12"
							ry="12"
							width={finderSize}
							x={x}
							y={y}
						/>
						<rect
							fill={bgColor}
							height={innerWhiteSize}
							rx="8"
							ry="8"
							width={innerWhiteSize}
							x={x + innerPadding}
							y={y + innerPadding}
						/>
						<rect
							fill={fgColor}
							height={innerBlackSize}
							rx="3"
							ry="3"
							width={innerBlackSize}
							x={x + innerPadding * 2}
							y={y + innerPadding * 2}
						/>
					</g>
				);
			})}
			{circles.map(({ cx, cy }) => (
				<circle
					cx={cx}
					cy={cy}
					fill={fgColor}
					key={`${cx}-${cy}`}
					r={circleRadius}
				/>
			))}
		</svg>
	);
}

/** A scannable quiet-zone plate with a one-click full-screen QR preview. */
function ExpandableQRCode({
	containerClassName,
	expandLabel = "Expand QR code",
	size = DEFAULT_SIZE,
	fgColor = "#000000",
	bgColor = "#ffffff",
	className,
	...props
}: ExpandableQRCodeProps) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<div
				className={cn(
					"relative inline-flex rounded-lg bg-white p-3",
					containerClassName
				)}
			>
				<QRCode
					bgColor={bgColor}
					className={className}
					fgColor={fgColor}
					size={size}
					{...props}
				/>
				<Button
					aria-label={expandLabel}
					className="absolute -top-2 -right-2 bg-background shadow-sm"
					onClick={() => setOpen(true)}
					size="icon-sm"
					title={expandLabel}
					type="button"
					variant="outline"
				>
					<Maximize2 />
				</Button>
			</div>

			<Dialog onOpenChange={setOpen} open={open}>
				<DialogContent className="inset-0 top-0 left-0 h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 place-items-center rounded-none border-none bg-background/95 p-6 backdrop-blur-xs sm:max-w-none sm:rounded-none">
					<DialogTitle className="sr-only">Expanded QR code</DialogTitle>
					<div className="inline-flex max-h-[min(82vh,800px)] max-w-[min(82vw,800px)] rounded-2xl bg-white p-6 shadow-xl sm:p-8">
						<QRCode
							bgColor={bgColor}
							className="size-[min(70vw,70vh)]"
							fgColor={fgColor}
							size={EXPANDED_SIZE}
							{...props}
						/>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

export type { ExpandableQRCodeProps, QRCodeProps };
export { ExpandableQRCode, QRCode };
