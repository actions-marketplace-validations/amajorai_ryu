// packages/marketplace/src/catalog/chrome/verified-badge.tsx
//
// The shared publisher check: one component and one Lucide mark on every surface,
// so the card and detail hero cannot disagree about publisher trust.
//
// THREE AXES, ONE CARD — the distinction this file exists to protect. A listing
// carries three independent trust facts and they are routinely confused:
//
//   `reviewed`     — did Ryu vet this LISTING's code? A GitHub topic-discovered
//                    listing is `reviewed: false` and gets the amber "Not
//                    reviewed by Ryu" alert (see community-trust-notice.tsx),
//                    which this badge can legitimately sit beside.
//   `verification` — did this listing's manifest SIGNATURE verify? That is
//                    INSTALL TRUST. It lives on the web marketplace's own card
//                    (apps/web/src/lib/marketplace-api.ts), where it owns the
//                    bare wire word `verified` and renders a destructive
//                    "Signature invalid" chip when it is false.
//   `orgVerified`  — is the PUBLISHING ORGANIZATION identity-verified? That is
//                    what THIS badge shows, and nothing else.
//
// They are orthogonal. A verified organization can publish an unreviewed
// community listing (we know exactly who they are; nobody has read their code),
// and an anonymous individual can publish a reviewed one. Both combinations
// render both signals. Anyone tempted to collapse them into one "trusted" flag
// should note that doing so silently upgrades one of those cases and silently
// downgrades the other — and that folding axis 3 onto axis 2's wire word would
// brand every listing from an unverified publisher as cryptographically
// tampered, which is precisely why the org fields carry an `org_` prefix.
//
// That is also why this badge is deliberately UNLIKE the community notice: the
// notice is a full-width amber alert placed in the reading path before any
// install control, this is a small inline publisher-trust chip beside the name.
// Different shape, different colour, different placement — they can sit on the
// same card without reading as a contradiction.
//
// THREE THINGS IN THIS REPO ARE ALSO CALLED "VERIFIED", which is why every
// string here leads with the word *organization* rather than saying "Verified":
// the web marketplace's signature chip above is labelled "Verified", and the
// reviews panel renders a "Verified purchase" chip on the same detail screen. A
// bare "Verified" here would be the third one and the user could not tell which
// claim it makes.

import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@ryu/ui/components/tooltip.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import {
	type PublisherTrustLevel,
	publisherTrustLabel,
	publisherTrustTooltip,
} from "@ryuhq/protocol/publisher-trust";
import { Badge, Check } from "lucide-react";

/** Chip geometry, matching `BASE_CHIP` in catalog-badges.tsx so the check lines
 *  up with the token/size badges it sits beside. */
const BASE_CHIP =
	"inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-3xl px-1.5 py-0.5 font-medium text-[11px] whitespace-nowrap";

/** Human label per verification tier.
 *
 *  NOTE the collision this map is written to survive: the tier vocabulary
 *  includes "community", which means "a community organization we have
 *  identity-checked" — NOT `origin === "community"`, which means "discovered
 *  from a public GitHub topic and reviewed by nobody". Rendering the bare tier
 *  word would put the string "Community" on a card next to an amber "Not
 *  reviewed by Ryu" alert and invite exactly the wrong reading, so the tier is
 *  never shown alone: it is always a qualifier on "Verified organization". */
const TIER_LABEL: Record<string, string> = {
	official: "Official",
	partner: "Partner",
	community: "Community",
};

/**
 * The badge's accessible name and tooltip text for a tier.
 *
 * An UNKNOWN tier degrades to the unqualified "Verified organization" rather
 * than dropping the badge or printing the raw token: `org_verified_tier` is a
 * plain string precisely because a newer control plane may mint a tier this
 * build has never heard of (the forward-tolerance `stability`/`surfaces` chose),
 * and losing the check entirely is a worse answer than losing its qualifier.
 *
 * Exported so the label rules are unit-testable without rendering.
 */
export function verifiedLabel(tier?: string | null): string {
	const known = tier ? TIER_LABEL[tier.trim().toLowerCase()] : undefined;
	return known ? `Verified organization — ${known}` : "Verified organization";
}

export function trustLabel(level: PublisherTrustLevel): string {
	return publisherTrustLabel(level);
}

/**
 * The publisher check, rendered beside a listing's NAME (never on its icon —
 * the icon is the app's identity, this is the publisher's).
 *
 * Renders nothing unless the caller passes `orgVerified`. The gate is the FLAG,
 * not the tier: a payload carrying `org_verified_tier` with `org_verified: false`
 * shows nothing, because the tier alone is a claim about a privilege the server
 * never granted — the same posture `mandatory` takes on `CatalogEntry`.
 */
export default function VerifiedBadge({
	orgVerified,
	publisherTrust,
	tier,
	tone = "card",
	className,
}: {
	className?: string;
	/** Is the PUBLISHING ORGANIZATION identity-verified? Server-derived,
	 *  absent/false renders nothing. Named for the axis on purpose: a bare
	 *  `verified` here would read as the manifest-signature flag the web
	 *  marketplace card carries under that exact word. */
	orgVerified?: boolean;
	/** The complete publisher identity mark. When present, dotted is intentional
	 * and renders for an allowed-but-not-verified community publisher. */
	publisherTrust?: PublisherTrustLevel | null;
	/** The org's verification tier, when known. Only a qualifier — see
	 *  {@link verifiedLabel}; an unrecognized value still renders the check. */
	tier?: string | null;
	/** Which surface the badge is painted on.
	 *
	 *  `"card"` sits on the page's own background and gets the themed info tint.
	 *  `"hero"` sits on the detail hero's author-supplied dither wash under a
	 *  black scrim, where every foreground is fixed white — a themed
	 *  themed-on-tint chip is illegible there, so it gets the hero's own
	 *  translucent chip treatment instead (the same one the hero badges use). */
	tone?: "card" | "hero";
}) {
	// New catalog payloads carry the complete publisher mark. Older Core-facing
	// payloads only carry the org flag and tier, so retain their established
	// semantics: an explicit true renders the tier-qualified organization badge;
	// false/absent renders nothing. In particular, do not infer a visible dotted
	// mark from a legacy false — dotted is meaningful only when the wire explicitly
	// says that this publisher trust level was resolved.
	const hasExplicitPublisherTrust =
		publisherTrust !== null && publisherTrust !== undefined;
	if (!(hasExplicitPublisherTrust || orgVerified)) {
		return null;
	}
	const level = publisherTrust ?? "blue";
	if (!level) {
		return null;
	}
	const label = hasExplicitPublisherTrust
		? trustLabel(level)
		: verifiedLabel(tier);
	const tooltip = hasExplicitPublisherTrust
		? publisherTrustTooltip(level)
		: label;
	return (
		// Self-contained Provider rather than assuming an ancestor: this badge
		// renders on both hosts, and web mounts no global TooltipProvider (desktop
		// does). Nesting one inside an existing provider is harmless.
		<TooltipProvider delay={0}>
			<Tooltip>
				<TooltipTrigger
					render={
						// A <span>, never a <button>: on the grid card this sits INSIDE the
						// row's own <button>, and a nested button is a DOM error that takes
						// the card down.
						//
						// `role="img"` + `aria-label` give the glyph a real accessible name
						// — the tooltip cannot, because TooltipContent is portaled and so
						// reaches neither a screen reader following the card's own
						// accessible name nor the static-markup tests.
						<span
							aria-label={label}
							className={cn(
								BASE_CHIP,
								level === "gold"
									? tone === "hero"
										? "relative overflow-hidden bg-[linear-gradient(135deg,rgba(255,240,133,0.38),rgba(250,200,0,0.28),rgba(237,178,0,0.32))] text-yellow-50 backdrop-blur-sm"
										: "relative overflow-hidden bg-[linear-gradient(135deg,#fff085_0%,#fac800_52%,#edb200_100%)] text-yellow-700 shadow-[0_0_8px_rgba(250,200,0,0.28)] dark:text-yellow-300"
									: level === "blue"
										? tone === "hero"
											? "bg-sky-200/20 text-sky-100 backdrop-blur-sm"
											: "bg-info/12 text-info"
										: "border border-muted-foreground/40 border-dashed bg-muted/20 text-muted-foreground/70 opacity-50 transition-opacity focus-within:opacity-100 hover:opacity-100",
								className
							)}
							role="img"
						>
							{level === "gold" ? (
								<>
									<span
										aria-hidden="true"
										className="t-plan-badge-sheen pointer-events-none"
									/>
									<span
										aria-hidden="true"
										className="t-plan-badge-border pointer-events-none"
									/>
								</>
							) : null}
							<span
								className={cn(
									"relative z-10 inline-flex size-3 items-center justify-center",
									level === "gold" &&
										"drop-shadow-[0_0_3px_rgba(250,200,0,0.7)]"
								)}
							>
								<Badge
									aria-hidden="true"
									className={cn(
										"absolute inset-0 size-3",
										level === "gold" && "text-yellow-700 dark:text-yellow-300"
									)}
									fill="currentColor"
									strokeWidth={1.5}
								/>
								<Check
									aria-hidden="true"
									className="relative size-2 text-background"
									strokeWidth={3}
								/>
							</span>
						</span>
					}
				/>
				<TooltipContent>{tooltip}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
