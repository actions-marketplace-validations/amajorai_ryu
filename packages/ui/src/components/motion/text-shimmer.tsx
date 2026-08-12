import {
	TEXT_SHIMMER_CLASS_NAME,
	TEXT_SHIMMER_KEYFRAMES,
	textShimmerStyle,
} from "@ryu/ui/lib/text-shimmer";
import { cn } from "@ryu/ui/lib/utils";
import type { CSSProperties, ElementType, ReactNode } from "react";

export interface TextShimmerProps {
	as?: ElementType;
	children: ReactNode;
	className?: string;
	duration?: number;
}

/**
 * The props the shimmer actually passes down. A bare `ElementType` intersects
 * every intrinsic element's props, which collapses `children`/`style` to
 * `never`; naming the three props the component sets keeps the polymorphism
 * without that collapse.
 */
type ShimmerHost = ElementType<{
	children?: ReactNode;
	className?: string;
	style?: CSSProperties;
}>;

export function TextShimmer({
	children,
	as = "span",
	duration = 2.5,
	className,
}: TextShimmerProps) {
	const Comp = as as ShimmerHost;

	return (
		<>
			<style>{TEXT_SHIMMER_KEYFRAMES}</style>
			<Comp
				className={cn("inline-block", TEXT_SHIMMER_CLASS_NAME, className)}
				style={textShimmerStyle(duration)}
			>
				{children}
			</Comp>
		</>
	);
}
