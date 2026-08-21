"use client";

import { formatCount as formatSharedCount } from "@ryu/ui/lib/number-format.ts";
import { cn } from "@ryu/ui/lib/utils";
import { GITHUB_SVGL, SvglIcon } from "./svgl-icon.tsx";

export interface GitHubStarsProps {
	className?: string;
	locales?: Intl.LocalesArgument;
	stargazersCount: number;
}

function formatCompactCount(
	count: number,
	_locales: Intl.LocalesArgument
): string {
	return formatSharedCount(count) ?? "—";
}

export function GitHubStars({
	stargazersCount,
	locales = "en-US",
	className,
}: GitHubStarsProps) {
	return (
		<span className={cn("inline-flex items-center gap-1", className)}>
			<SvglIcon className="size-4" spec={GITHUB_SVGL} />
			<span
				className="text-[0.8125rem]/none text-muted-foreground tabular-nums"
				style={{ textBox: "trim-end cap alphabetic" }}
			>
				{formatCompactCount(stargazersCount, locales)}
			</span>
		</span>
	);
}
