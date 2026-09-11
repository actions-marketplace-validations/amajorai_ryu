import type { ReactNode } from "react";
import { COMPOSER_ICONS } from "../lib/app-icon-composer.mjs";
import { cn } from "../lib/utils";

/** Native manifest IDs and public catalog namespace IDs refer to the same art. */
export function composerIconFor(id: string | null | undefined) {
	if (!id) {
		return null;
	}
	for (const key of [id, `@${id}`]) {
		if (Object.hasOwn(COMPOSER_ICONS, key)) {
			return COMPOSER_ICONS[key] ?? null;
		}
	}
	return null;
}

/** Completed artwork, shared by client catalogs and server-rendered listings. */
export default function AppIconArtwork({
	id,
	className,
	size = 40,
	fallback = null,
}: {
	id: string | null | undefined;
	className?: string;
	size?: number;
	fallback?: ReactNode;
}) {
	const artwork = composerIconFor(id);
	if (!artwork) {
		return fallback;
	}
	return (
		<span
			className={cn(
				"relative flex shrink-0 items-center justify-center",
				className
			)}
			data-app-icon="layered"
		>
			<img
				alt=""
				className="size-full dark:hidden"
				height={size}
				loading="lazy"
				src={artwork.light}
				width={size}
			/>
			<img
				alt=""
				className="hidden size-full dark:block"
				height={size}
				loading="lazy"
				src={artwork.dark}
				width={size}
			/>
		</span>
	);
}
