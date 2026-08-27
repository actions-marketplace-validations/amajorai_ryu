import { cn } from "@ryu/ui/lib/utils.ts";
import { IconAt } from "@tabler/icons-react";
import type { CSSProperties, ReactNode } from "react";
import type { MentionItem } from "./types.ts";

const SAFE_MENTION_COLOR =
	/^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^()]{1,96}\)|[a-z]{1,24})$/i;

function safeMentionColor(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed && SAFE_MENTION_COLOR.test(trimmed) ? trimmed : undefined;
}

function mentionStyle(
	item: MentionItem | undefined
): CSSProperties | undefined {
	const accent = safeMentionColor(item?.accentColor);
	if (!accent) {
		return undefined;
	}

	return {
		"--mention-accent": accent,
		"--mention-ink": `color-mix(in srgb, ${accent} 68%, #111827 32%)`,
		color: `color-mix(in srgb, ${accent} 68%, #111827 32%)`,
	} as CSSProperties;
}

export interface MentionTokenProps {
	children: ReactNode;
	className?: string;
	item?: MentionItem;
}

/** The shared inline treatment for composer and transcript mentions. */
export function MentionToken({ children, className, item }: MentionTokenProps) {
	const hasAccent = Boolean(safeMentionColor(item?.accentColor));
	const icon = item?.visualIcon ?? item?.icon;

	return (
		<span
			className={cn(
				"inline-flex max-w-full items-center gap-1 align-baseline font-medium text-[0.9em] leading-[1.2] transition-colors",
				hasAccent
					? "[&_em]:!text-[color:var(--mention-ink)] [&_strong]:!text-[color:var(--mention-ink)] text-[color:var(--mention-ink)] hover:text-[color:var(--mention-accent)]"
					: "text-primary",
				className
			)}
			data-mention-token={item?.kind ?? "reference"}
			style={mentionStyle(item)}
		>
			<span
				aria-hidden="true"
				className="inline-flex size-3.5 shrink-0 items-center justify-center [&>svg]:size-3.5"
			>
				{icon ?? <IconAt className="size-3.5" />}
			</span>
			<span className="min-w-0 truncate">{children}</span>
		</span>
	);
}
