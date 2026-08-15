"use client";

// packages/ui/src/components/username-marquee.tsx
//
// The claimed-username reel: `ryuhq.com/u/` pinned to the left of a vertical
// TextMarquee of example handles. This is the social proof on the /username
// marketing page and on the referral surfaces — the same spell.sh demo names,
// re-prefixed to our host. Lives in the UI package (not in apps/web) because
// the waitlist queue (`waitlist-queue.tsx`) shares a referral step with the
// desktop app and needs the identical reel.
//
// The rows are deliberately NOT links. These are example handles, not real
// profiles, and a marquee full of dead links teaches the wrong lesson. When a
// handle resolves to a real public profile, the reel can start linking per-row.

import { TextMarquee } from "./text-marquee.tsx";

/** The demo handles the spell.sh reel scrolled; re-used so the look matches. */
export const MARQUEE_USERNAMES = [
	"emily",
	"dennis",
	"max",
	"michele",
	"adgv",
	"tomm",
	"hugh",
	"alex",
] as const;

export function UsernameMarquee({
	className,
	height = 200,
	speed = 1,
}: {
	className?: string;
	height?: number;
	speed?: number;
}) {
	return (
		<TextMarquee
			className={className}
			height={height}
			prefix={<span className="text-muted-foreground">ryuhq.com/u/</span>}
			speed={speed}
		>
			{MARQUEE_USERNAMES.map((name) => (
				<span className="font-medium text-foreground" key={name}>
					{name}
				</span>
			))}
		</TextMarquee>
	);
}

export default UsernameMarquee;
