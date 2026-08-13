// Standalone browser story for the REAL sidebar brand badge — the logo lockup
// plus the "Research Preview" pill at the top of the desktop sidebar.
//
// It exists for the pill's SHAPE. The pill is square on the bottom-left and its
// BorderBeam has to follow; BorderBeam only accepts a scalar radius, so the
// per-corner cut is a CSS override (`.beam-notch-bl` in `src/index.css`) that has
// to out-specify the beam's own generated `[data-beam][data-active]::after` rules.
// Only a real browser computes that cascade, and only a real browser resolves the
// pseudo-element styles the spec reads back.
//
// The second column is the CONTROL: the same BorderBeam preset WITHOUT the
// override class. Its bottom-left corner must stay round — otherwise the spec's
// assertion on the badge would pass no matter what the CSS said.

import { BorderBeam } from "@ryu/ui/components/border-beam.tsx";
import { createRoot } from "react-dom/client";
import { SidebarBrandBadge } from "@/src/components/layout/SidebarBrandBadge.tsx";
import "../../src/index.css";

function Panel({ dark, label }: { dark: boolean; label: string }) {
	return (
		<div
			className={`${dark ? "dark" : ""} flex-1 bg-background p-8 text-foreground`}
		>
			<p className="mb-6 font-medium text-muted-foreground text-xs uppercase tracking-widest">
				{label}
			</p>
			<div className="w-64" data-testid={`badge-${dark ? "dark" : "light"}`}>
				<SidebarBrandBadge />
			</div>
		</div>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<div className="flex min-h-screen">
		<Panel dark={false} label="Light" />
		<Panel dark label="Dark" />
		<div className="dark flex-1 bg-background p-8 text-foreground">
			<p className="mb-6 font-medium text-muted-foreground text-xs uppercase tracking-widest">
				Control (no notch override)
			</p>
			<div data-testid="control">
				<BorderBeam
					borderRadius={999}
					className="inline-flex shrink-0"
					colorVariant="colorful"
					size="sm"
					strength={0.85}
					theme="dark"
				>
					<div className="inline-flex h-5 items-center rounded-full bg-muted px-2 font-medium text-xs leading-none">
						Research Preview
					</div>
				</BorderBeam>
			</div>
		</div>
	</div>
);
