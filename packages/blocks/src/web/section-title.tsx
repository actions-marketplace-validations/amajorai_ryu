import { cn } from "@ryu/ui/lib/utils.ts";
import type { ReactNode } from "react";

const sectionTitleSizes = {
	default: "text-2xl md:text-3xl",
	large: "text-3xl md:text-4xl",
	small: "text-xl md:text-2xl",
	compact: "text-lg md:text-xl",
} as const;

export type SectionTitleSize = keyof typeof sectionTitleSizes;

export const sectionTitleClass =
	"text-balance font-heading font-medium text-2xl text-foreground leading-tight tracking-tight md:text-3xl";

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
}: SectionTitleProps) {
	return (
		<Tag
			className={cn(
				"text-balance font-heading font-medium text-foreground leading-tight tracking-tight",
				sectionTitleSizes[size],
				className
			)}
		>
			{title}
			{suffix}
		</Tag>
	);
}
