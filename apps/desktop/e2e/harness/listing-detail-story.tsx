// Standalone browser story for the REAL store-listing detail shell
// (`@ryu/marketplace/catalog/detail/listing-detail-shell`) — the one layout every
// Store tab's preview dialog now renders inside: hero, action bar, divided stat
// strip, screenshot rail, and a two-column body (content + Information rail).
//
// WHY A STORY. The shell only ever appears inside a `<Dialog>` opened from a
// catalog section, which needs Core (a node, a catalog fetch, a selection). None
// of that is a property of the LAYOUT, and the layout is the thing that regressed:
// the preview was authored for a 26rem side pane that no caller can open any more,
// so a wide dialog rendered one thin column with a gutter of air. Mounting the
// shell directly, at the dialog's real width, is what makes "is it actually two
// columns / does it scroll sideways / does the stat strip divide evenly"
// answerable — and none of those questions can be answered by a type-check.
//
// It mounts the real exported components, never a copy: a story that certifies a
// fork of the layout certifies nothing.

import {
	ListingAsideCard,
	ListingDetailShell,
	ListingGalleryRail,
	ListingHero,
	ListingInfoGrid,
	ListingSection,
	ListingStatStrip,
} from "@ryu/marketplace/catalog/detail/listing-detail-shell";
import { Badge } from "@ryu/ui/components/badge";
import { Button } from "@ryu/ui/components/button";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

/** The dialog geometry from `StoreCatalogLayout` / `MarketplaceDetailDialog`,
 *  reproduced exactly. Not imported, because both call sites bake it into a
 *  `<DialogContent>` that would need a Dialog root and a portal — and the number
 *  is the thing under test, so it is spelled out here rather than trusted. */
const DIALOG_CLASS =
	"mx-auto max-h-[88vh] w-[min(80rem,94vw)] overflow-y-auto overflow-x-hidden rounded-xl border bg-background shadow-lg";

/** A deliberately LONG value set. A layout that only survives short strings is
 *  what produced the early-wrapping preview in the first place. */
const INFO_ROWS = [
	{ label: "Developer", value: "Ryu Systems, Inc." },
	{ label: "Category", value: "Productivity" },
	{ label: "Version", value: "2026.7.1-1" },
	{ label: "License", value: "Apache-2.0" },
	{ label: "Website", value: "https://example.com/a-fairly-long-path/page" },
	{ label: "Privacy Policy", value: "https://example.com/privacy" },
];

function Story() {
	return (
		<div className="min-h-svh bg-muted/40 p-8">
			<div className={DIALOG_CLASS} data-testid="dialog">
				<ListingDetailShell
					actions={
						<>
							<Button size="sm">Add</Button>
							<Button size="sm" variant="outline">
								Settings
							</Button>
							<span
								className="ml-auto flex shrink-0 items-center gap-2"
								data-testid="status"
							>
								<Badge variant="secondary">Added</Badge>
							</span>
						</>
					}
					aside={
						<>
							<ListingAsideCard title="Information">
								<ListingInfoGrid rows={INFO_ROWS} />
							</ListingAsideCard>
							<ListingAsideCard title="Tags">
								<div className="flex flex-wrap gap-1">
									{["browser", "automation", "headless", "chromium"].map(
										(tag) => (
											<Badge
												className="font-normal text-xs"
												key={tag}
												variant="outline"
											>
												{tag}
											</Badge>
										)
									)}
								</div>
							</ListingAsideCard>
						</>
					}
					gallery={
						<ListingGalleryRail
							name="Example App"
							// Real https URLs the harness cannot fetch: what is under test
							// is the RAIL (frame size, snap, horizontal scroll), and the
							// component's `safeHttpUrl` guard rejects data: URLs by design,
							// so a data-URL placeholder would silently render nothing and
							// prove the opposite of what it looks like it proves.
							screenshots={[1, 2, 3, 4, 5].map(
								(n) => `https://example.invalid/shot-${n}.png`
							)}
						/>
					}
					hero={
						<ListingHero
							badges={["Built-in", "Required", "COMPANION", "TOOL"]}
							dither={{ from: 250, to: "transparent", direction: "down" }}
							icon={
								<span className="font-semibold text-2xl text-white">E</span>
							}
							name="Example App With A Fairly Long Listing Name"
							tagline="Clears your inbox, sends emails, manages your calendar, and checks you in for flights."
						/>
					}
					stats={
						<ListingStatStrip
							items={[
								{
									label: "52 Ratings",
									sub: "★★★★☆",
									value: "4.6",
								},
								{ label: "Health", sub: "88/100", value: "A" },
								{ label: "Version", value: "v2026.7.1-1" },
								{ label: "Category", value: "Productivity" },
								{ label: "Developer", value: "Ryu Systems, Inc." },
								{ label: "Updated", value: "2 weeks ago" },
								{ label: "Downloads", value: "12.4k" },
								{ label: "Runs on", value: "Desktop, Island, Mobile" },
							]}
						/>
					}
				>
					<ListingSection title="About">
						<p className="text-muted-foreground text-sm leading-relaxed">
							{"Lorem ipsum dolor sit amet, ".repeat(24)}
						</p>
					</ListingSection>
					<ListingSection title="Permissions">
						<ul className="flex flex-col gap-1.5">
							{["Read files", "Network access", "Run commands"].map((g) => (
								<li className="rounded-md border px-3 py-1.5" key={g}>
									<div className="font-medium text-sm">{g}</div>
									<div className="text-muted-foreground text-xs">
										A one-line plain-English description of the grant.
									</div>
								</li>
							))}
						</ul>
					</ListingSection>
				</ListingDetailShell>
			</div>
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
document.body.setAttribute("data-harness-ready", "1");
