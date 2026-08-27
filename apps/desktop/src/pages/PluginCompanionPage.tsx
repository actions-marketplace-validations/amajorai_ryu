// The desktop-rendered surface for a plugin-contributed **companion**
// (`RunnableKind::Companion`). Companions are declared in a plugin's manifest and
// surfaced by Core via `GET /api/plugins/contributions`; this page is where an
// enabled plugin's companion becomes a navigable, visible panel in the shell.
//
// Third-party code-execution gate: a companion that carries a UI bundle
// (`hasUi`) mounts the plugin's own sandboxed UI through `PluginHostPanel` →
// `ExtensionHost` (a null-origin iframe, capability-gated against the plugin's
// Gateway-approved grants). A companion WITHOUT a bundle renders the benign,
// data-driven summary below and runs no plugin code at all.

import { Package01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@ryu/ui/components/badge";
import { Button } from "@ryu/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ryu/ui/components/empty";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { FRONTEND_URL } from "@/lib/auth-client.ts";
import { openExternal } from "@/lib/tauri-bridge.ts";
import { useEntitlementContext } from "@/src/contexts/entitlement-context.tsx";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { PluginHostPanel } from "@/src/contributions/host/PluginHostPanel.tsx";
import { useMyLicenses } from "@/src/hooks/useMyLicenses.ts";
import { usePluginContributions } from "@/src/hooks/usePluginContributions.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import { recordMarketplaceMembershipUsage } from "@/src/lib/api/marketplace.ts";
import type { PluginCompanion } from "@/src/lib/api/plugins.ts";
import {
	setMarketplaceAppsEntitled,
	setMarketplaceDirectLicensedItems,
} from "@/src/lib/api/preferences.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";

function MembershipRequired({
	children,
	companion,
}: {
	children: ReactNode;
	companion: PluginCompanion | undefined;
}) {
	const { ready, requestUpgrade, verdict } = useEntitlementContext();
	const { isLicensed, licenses, loading } = useMyLicenses();
	const directLicense = companion
		? isLicensed("app", companion.pluginId)
		: false;
	const required = Boolean(companion?.membershipRequired);
	const hasAccess =
		!required || directLicense || Boolean(verdict?.marketplaceApps);
	const usageKey = useRef<string | null>(null);
	const [directLicenseSyncReady, setDirectLicenseSyncReady] = useState(
		!required
	);

	useEffect(() => {
		if (!required || loading) {
			return;
		}
		const target = toTarget(useNodeStore.getState().getActiveNode());
		Promise.all([
			setMarketplaceAppsEntitled(target, Boolean(verdict?.marketplaceApps)),
			setMarketplaceDirectLicensedItems(
				target,
				licenses
					.filter(
						(license) =>
							license.status === "active" && license.itemKind === "app"
					)
					.map((license) => license.itemId)
			),
		]).finally(() => setDirectLicenseSyncReady(true));
	}, [licenses, loading, required, verdict?.marketplaceApps]);

	useEffect(() => {
		if (
			!required ||
			directLicense ||
			!verdict?.marketplaceApps ||
			!companion?.pluginId ||
			usageKey.current
		) {
			return;
		}
		const idempotencyKey =
			typeof crypto?.randomUUID === "function"
				? crypto.randomUUID()
				: `membership-${companion.pluginId}-${Date.now()}`;
		usageKey.current = idempotencyKey;
		recordMarketplaceMembershipUsage({
			id: companion.pluginId,
			idempotencyKey,
			kind: "app",
		}).catch(() => {
			usageKey.current = null;
		});
	}, [companion?.pluginId, directLicense, required, verdict?.marketplaceApps]);

	if (!required || hasAccess) {
		return <>{children}</>;
	}

	if (!ready || loading || !directLicenseSyncReady) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-muted-foreground text-sm">
				Checking Marketplace access...
			</div>
		);
	}

	return (
		<div className="flex h-full items-center justify-center p-6">
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<HugeiconsIcon icon={Package01Icon} />
					</EmptyMedia>
					<EmptyTitle>Upgrade to use</EmptyTitle>
					<EmptyDescription>
						This paid Marketplace app is included with an active Ryu Membership
						or recurring plan. Your direct app license still works without
						Membership.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button
						onClick={() => {
							openExternal(
								`${FRONTEND_URL.replace(/\/$/, "")}/pricing#marketplace-membership`
							).catch(() => requestUpgrade());
						}}
						size="sm"
					>
						View Membership plans
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	);
}

/**
 * The shared "this app isn't here" state for every route that resolves to a companion.
 *
 * Exported because TWO paths reach it and they must not drift: mounting a companion by
 * id that the feed no longer reports (a disabled plugin), and the short-path alias
 * route in `contributions/builtins.ts`, which resolves a path like `/inbox` against the
 * feed and finds no owner. That second path used to render `null` — a truly blank tab —
 * which is worse than it sounds: most apps are install-on-demand, so on a fresh install the
 * palette's "Inbox" row, an OS notification click, the Timeline hotkey and the tray's
 * "Open Timeline" all landed on blank with nothing to explain it or act on.
 *
 * The copy is deliberately cause-neutral ("not enabled" rather than "no longer
 * enabled") because both causes reach it — never-enabled and since-disabled — and it
 * names the Store so the state is actionable instead of a dead end.
 */
export function CompanionUnavailable() {
	const { openTab } = useTabsContext();

	return (
		<div className="flex h-full items-center justify-center p-6">
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<HugeiconsIcon icon={Package01Icon} />
					</EmptyMedia>
					<EmptyTitle>App not enabled</EmptyTitle>
					<EmptyDescription>
						No enabled app provides this view. Enable it from the Store, or it
						may have been disabled.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button onClick={() => openTab("/apps", { title: "Apps" })} size="sm">
						Open Apps
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	);
}

export default function PluginCompanionPage({
	companionId,
	mountContext,
}: {
	companionId: string;
	/** Optional host-supplied context baked into the sandboxed frame as
	 *  `window.ryu.context` (e.g. `{ workflowId }` when a deep-link opens the
	 *  Workflows canvas on a specific workflow). Forwarded to PluginHostPanel. */
	mountContext?: unknown;
}) {
	const { companions } = usePluginContributions();
	const companion = companions.find((c) => c.id === companionId);

	// Stabilise the context by serialized content so an inline `{ workflowId }`
	// object from a route render-fn doesn't churn a new reference each render (the
	// frame's srcdoc is memoized on `mountContext` identity — an unstable ref would
	// reload the iframe on every parent re-render).
	const contextKey = JSON.stringify(mountContext ?? null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: contextKey is the content hash of mountContext.
	const stableContext = useMemo(() => mountContext, [contextKey]);

	if (!companion) {
		return <CompanionUnavailable />;
	}

	// The single decision gate for running third-party code: no bundle → the benign
	// summary below; never a fetch, never code. Membership is checked around both
	// paths so an opted-in paid app cannot keep running after a recurring plan ends.
	const content = companion.hasUi ? (
		<PluginHostPanel companion={companion} mountContext={stableContext} />
	) : null;

	// `app__<runnable id>` — strip the `app__` prefix for a cleaner owning-plugin
	// hint without hardcoding any specific plugin.
	const ownerHint = companion.id.startsWith("app__")
		? companion.id.slice("app__".length)
		: companion.id;

	const summary = (
		<div className="scroll-fade flex h-full flex-col overflow-y-auto p-6">
			<div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
				<div className="flex items-center gap-3">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
						<HugeiconsIcon className="size-5" icon={Package01Icon} />
					</div>
					<div className="min-w-0">
						<h1 className="truncate font-semibold text-lg">
							{companion.label || companion.name}
						</h1>
						<p className="truncate text-muted-foreground text-sm">
							Companion surface · {ownerHint}
						</p>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="secondary">Plugin companion</Badge>
					{companion.shortcut ? (
						<Badge variant="outline">{companion.shortcut}</Badge>
					) : null}
				</div>

				<div className="rounded-lg border bg-card p-4 text-card-foreground text-sm leading-relaxed">
					<p>
						<span className="font-medium">{companion.name}</span> is provided by
						an enabled plugin and is available here. This plugin ships no
						interface of its own, so there is nothing more to show — it works
						through the rest of the app.
					</p>
				</div>
			</div>
		</div>
	);

	return (
		<MembershipRequired companion={companion}>
			{content ?? summary}
		</MembershipRequired>
	);
}
