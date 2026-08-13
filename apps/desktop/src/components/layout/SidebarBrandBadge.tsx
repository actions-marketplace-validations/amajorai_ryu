// Logo lockup + "Research Preview" pill, at the top of the sidebar header.
//
// THE SHAPE IS THE POINT. The pill is a speech bubble — fully rounded except a
// square bottom-left — and the BorderBeam around it has to trace that same
// outline. BorderBeam takes a single scalar radius (it emits `border-radius: Npx`
// and `clip-path: inset(0 round Npx)` onto its ::before/::after/bloom layers), so
// the per-corner cut can't come from the prop. It lives in the `.beam-notch-bl`
// rule in `src/index.css`, applied to BOTH the beam wrapper and the shell inside
// it so the radius has one definition. `e2e/sidebar-brand-badge.spec.ts` reads the
// beam's computed pseudo-element styles back to prove the override still wins —
// the generated rules are `[data-beam][data-active]::after`, which a bare class
// selector loses to on specificity.
//
// Beam preset matches BuildBadge (metal-fx freezes after first paint in the
// sidebar WebView).

import { BorderBeam } from "@ryu/ui/components/border-beam.tsx";
import { Logo } from "@ryu/ui/components/logo.tsx";
import { useTheme } from "next-themes";
import { useBuildProfile } from "@/src/lib/build-profile.ts";
import { channelLabel } from "@/src/lib/channel-brand.ts";
import { useReleaseChannel } from "@/src/lib/release-channel.ts";

/**
 * What the pill reads. The base name and every channel suffix come from the same
 * table that stamps the shipped bundle's `productName`, so the pill and the app's
 * OS-registered name can never disagree.
 */
function badgeLabel(dev: boolean, channel: string): string {
	const base = channelLabel("stable");
	if (dev) {
		return `${base} (${channelLabel("dev")})`;
	}
	if (channel === "stable") {
		return base;
	}
	return `${base} (${channelLabel(channel)})`;
}

export function SidebarBrandBadge({ className }: { className?: string } = {}) {
	const { resolvedTheme } = useTheme();
	const beamTheme = resolvedTheme === "light" ? "light" : "dark";
	const { dev } = useBuildProfile();
	const [channel] = useReleaseChannel();

	return (
		<div
			className={`flex w-full items-center gap-2 px-3 py-1.5 ${className ?? ""}`}
		>
			<div className="shrink-0 text-left">
				<Logo className="text-foreground" size="20px" variant="outline" />
			</div>
			<BorderBeam
				// Only the fallback shape; `.beam-notch-bl` re-cuts every beam layer.
				borderRadius={999}
				className="beam-notch-bl inline-flex shrink-0"
				colorVariant="colorful"
				size="sm"
				strength={0.85}
				theme={beamTheme}
			>
				<div className="beam-notch-bl inline-flex h-5 items-center bg-muted px-2 font-medium text-xs leading-none">
					{badgeLabel(dev, channel)}
				</div>
			</BorderBeam>
		</div>
	);
}
