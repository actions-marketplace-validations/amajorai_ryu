"use client";

import type { CSSProperties } from "react";

export interface RyuAssistantWidgetIframeProps {
	/** Optional permissions requested by the hosted widget, kept explicit. */
	allow?: string;
	className?: string;
	height?: CSSProperties["height"];
	loading?: "eager" | "lazy";
	src: string;
	style?: CSSProperties;
	title?: string;
	width?: CSSProperties["width"];
}

/**
 * Safe-by-default iframe wrapper for a hosted assistant surface. Scripts are
 * allowed, but the frame keeps an opaque origin and cannot navigate the parent,
 * submit arbitrary forms, or request ambient browser capabilities.
 */
export function RyuAssistantWidgetIframe({
	allow,
	className,
	height = "100%",
	loading = "lazy",
	src,
	style,
	title = "Ryu assistant",
	width = "100%",
}: RyuAssistantWidgetIframeProps) {
	return (
		<iframe
			allow={allow}
			className={className}
			loading={loading}
			referrerPolicy="strict-origin-when-cross-origin"
			sandbox="allow-scripts"
			src={src}
			style={{ border: 0, height, width, ...style }}
			title={title}
		/>
	);
}
