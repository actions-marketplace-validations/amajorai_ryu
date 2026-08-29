"use client";

import { ChromaticTextReveal } from "@ryu/ui/components/motion/chromatic-text-reveal";
import { cn } from "@ryu/ui/lib/utils.ts";
import type { ReactNode } from "react";
import { landingHeadlineClass } from "./landing-typography.ts";

const sectionTitleSizes = {
	default: landingHeadlineClass,
	large: landingHeadlineClass,
	small: landingHeadlineClass,
	compact: landingHeadlineClass,
} as const;

export type SectionTitleSize = keyof typeof sectionTitleSizes;

export const sectionTitleClass = sectionTitleSizes.default;

interface SectionTitleProps {
	as?: "h1" | "h2";
	className?: string;
	colors?: string[];
	delay?: number;
	duration?: number;
	size?: SectionTitleSize;
	suffix?: ReactNode;
	title: string;
}

export function SectionTitle({
	title,
	suffix,
	as: Tag = "h2",
	size = "default",
	className,
	colors,
	delay = 0,
	duration = 1.35,
}: SectionTitleProps) {
	const lastSpaceIndex = title.lastIndexOf(" ");
	const prefix = lastSpaceIndex === -1 ? "" : title.slice(0, lastSpaceIndex);
	const lastWord =
		lastSpaceIndex === -1 ? title : title.slice(lastSpaceIndex + 1);

	return (
		<Tag className={cn(sectionTitleSizes[size], className)}>
			<ChromaticTextReveal
				colors={colors}
				delay={delay}
				duration={duration}
				loop={false}
				once
				prefix={prefix}
				startOnView
				words={[lastWord]}
			/>
			{suffix}
		</Tag>
	);
}
