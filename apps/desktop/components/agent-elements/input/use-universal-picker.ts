"use client";

// Builds the universal picker's body data (Ryu — with its providers nested
// under it — plus external agents) and hands `useComposerAgentControls` a
// `renderBody` it can pass to `ComposerSettingsMenu`. This hook owns the extra
// data the legacy sibling-section picker never needed:
//   - Pi provider catalog + active config (`usePiConfig`) → the Providers section,
//     with per-provider `configured` gating and the active route highlighted.
//   - The installable agents catalog (`useAgentsCatalog`) → the not-installed
//     external agents rendered greyed with an Install button.
//   - The Gateway dialog opener (`useGatewayDialog`) → the "Configure credentials"
//     link target for an unconfigured provider.
//   - The credit-pool catalog + the user's grants (`@ryu/auth/lib/credit-pools`,
//     `useCreditGrants`) → the pool-backed managed rows ("Ryu Fast", "Ryu
//     Frontier"), which are the SAME provider row shape with a pool-owned name,
//     their own model discovery, and a pool-aware upsell rule.
//
// The active agent's LIVE model/approval/thinking sections are passed in (they
// wire to the host's live handlers) and nested under whichever row is active, so
// changing the current target's model still updates the running turn. Non-active
// external agents are probed lazily inside the body (see `ExternalAgentSettings`).

import {
	ALL_CREDIT_POOLS,
	type CreditPool,
	type CreditPoolId,
} from "@ryu/auth/lib/credit-pools";
import { createElement, type ReactNode, useCallback, useMemo } from "react";
import type { ComposerSettingsSection } from "@/components/agent-elements/input/composer-settings-menu.tsx";
import {
	type ProviderEntry,
	type TeamEntry,
	UniversalPickerBody,
	type UniversalPickerData,
} from "@/components/agent-elements/input/universal-picker-body.tsx";
import { useEntitlementContext } from "@/src/contexts/entitlement-context.tsx";
import { useAgentsCatalog } from "@/src/hooks/useAgentsCatalog.ts";
import { useCreditGrants } from "@/src/hooks/useCreditGrants.ts";
import { usePiConfig } from "@/src/hooks/usePiConfig.ts";
import { engineForAgent } from "@/src/lib/agent-logos.tsx";
import type { AgentSummary } from "@/src/lib/api/agents.ts";
import {
	filterEnabledModels,
	type PiProvider,
} from "@/src/lib/api/pi-config.ts";
import type { Team } from "@/src/lib/api/teams.ts";
import { useAgentAutoDialog } from "@/src/store/useAgentAutoDialog.ts";
import { useGatewayDialog } from "@/src/store/useGatewayDialog.ts";

/** The flagship agent id (mirrors Core `DEFAULT_AGENT_ID`). */
const RYU_AGENT_ID = "ryu";

/** Map a Pi provider id to the engine key its brand logo is registered under. */
const PROVIDER_ENGINE_KEY: Record<string, string> = {
	google: "gemini",
	"claude-pro-max": "claude",
	"openai-codex": "codex",
	anthropic: "anthropic",
	openai: "openai",
	mistral: "mistral",
	openrouter: "openrouter",
};

function providerEngineKey(providerId: string): string {
	return PROVIDER_ENGINE_KEY[providerId] ?? providerId;
}

/**
 * The credit pools a user may be offered as a route ("Ryu Fast", "Ryu Frontier"),
 * straight from the pool catalog. Filtering on `visible` here is the whole point:
 * adding, hiding or renaming a pool is then a data change in
 * `@ryu/auth/lib/credit-pools`, never an edit to this picker. It also
 * deliberately excludes the pass-through `openrouter` pool, which is invisible —
 * that supply is what the ORIGINAL managed Ryu row already sells, and offering it
 * twice under two names would be the same route pretending to be a choice.
 */
const OFFERED_CREDIT_POOLS: readonly CreditPool[] = ALL_CREDIT_POOLS.filter(
	(pool) => pool.visible
);

/**
 * The pool a managed catalog row is backed by, or null for a row that is not
 * pool-backed (today: the default managed OpenRouter route, and every BYO-key
 * provider).
 *
 * `managed` is a REQUIRED part of the match, not an accelerator. A user's own
 * Bedrock or Cloudflare credential is a perfectly ordinary BYO-key provider whose
 * id collides with a pool's `gatewayProviders` entry; treating that as Ryu's
 * donated supply would relabel the user's own account "Ryu Frontier" and gate it
 * behind our subscription upsell.
 *
 * Three id spellings are accepted because Core owns the provider id and this
 * surface does not: whichever of `bedrock` / `managed-bedrock` Core publishes,
 * the row binds. A row that matches nothing keeps today's behaviour exactly.
 */
function creditPoolForProvider(provider: PiProvider): CreditPool | null {
	if (!provider.managed) {
		return null;
	}
	return (
		OFFERED_CREDIT_POOLS.find(
			(pool) =>
				provider.id === pool.id ||
				provider.id === `managed-${pool.id}` ||
				pool.gatewayProviders.includes(provider.id)
		) ?? null
	);
}

/**
 * Upsell copy for a pool row. Names the TIER and nothing else — the pool catalog's
 * standing rule is that a user never reads the name of the provider behind a pool,
 * so the supplier can be swapped without changing what anyone was promised.
 * There is no bring-your-own-key half: Ryu's pooled capacity is not something a
 * user can hold a key for, so offering one would be a dead end.
 */
function poolUpsellCopy(pool: CreditPool): { byoKey: null; upgrade: string } {
	return {
		upgrade: `${pool.label} runs on Ryu's own capacity — included with a Ryu subscription, no API keys.`,
		byoKey: null,
	};
}

export interface UseUniversalPickerParams {
	/** The active agent's live approval + thinking sections. */
	activeExtraSections: ComposerSettingsSection[];
	/** The active agent's live model section (already resolved by the host). */
	activeModelSection: ComposerSettingsSection | null;
	agentId: string | null;
	agents: AgentSummary[];
	onCreateAgent?: () => void;
	onSelectAgent: (id: string) => void;
	onSelectTeam?: (id: string) => void;
	teamId?: string | null;
	teams?: Team[];
}

export interface UseUniversalPickerResult {
	/** Body renderer for `ComposerSettingsMenu`'s `renderBody` prop. */
	renderBody: (close: () => void) => ReactNode;
}

export function useUniversalPicker(
	params: UseUniversalPickerParams
): UseUniversalPickerResult {
	const {
		agents,
		agentId,
		teamId = null,
		teams = [],
		onSelectAgent,
		onSelectTeam,
		onCreateAgent,
		activeModelSection,
		activeExtraSections,
	} = params;

	const { config, catalog, save } = usePiConfig();
	const catalogAgents = useAgentsCatalog();
	const openGateway = useGatewayDialog((s) => s.openGateway);
	const openAgentAutoConfig = useAgentAutoDialog((s) => s.openAgentAutoConfig);
	const { verdict, requestUpgrade } = useEntitlementContext();
	// True only with an active PAID managed plan. The managed provider is always
	// `configured` server-side (wallet-gated at the Gateway), so the composer upsell
	// gates on the entitlement here, not on `configured`. `verdict` is null until the
	// first resolution; treat unresolved as "no plan" (shows the upsell, flips when ready).
	const hasManagedPlan = verdict?.managedInference ?? false;
	// Pools the user holds granted credit in. A campaign grant is the OTHER way a
	// pool row becomes usable without a paid plan, and it is the whole point of the
	// frontier ladder: someone handed $50 of "Ryu Frontier" must be shown that
	// pool's models, not an ad for the subscription that money already substitutes
	// for. Empty whenever grants are unavailable, which degrades to the plan-only
	// rule this picker used before pools existed.
	const { pools: grantPools } = useCreditGrants();
	// Rows whose label this build cannot map back to a catalog id are skipped: the
	// upsell rule is a per-pool decision, and a null id names no pool. Skipping
	// keeps the pre-grant behaviour (the row still upsells) instead of suppressing
	// the upsell on some other pool's money.
	const grantedPoolIds = useMemo(
		() =>
			new Set(
				grantPools
					.map((pool) => pool.poolId)
					.filter((poolId): poolId is CreditPoolId => poolId !== null)
			),
		[grantPools]
	);
	// The same grants keyed for DISPLAY: pool id → the dollars left in it and when
	// they lapse. `useCreditGrants` already drops non-positive pools, so a present
	// entry always has money in it and the badge never renders "$0.00".
	const grantByPoolId = useMemo(() => {
		const index = new Map<
			CreditPoolId,
			{ expiresAt: string | null; remainingMicroUsd: number }
		>();
		for (const pool of grantPools) {
			if (pool.poolId !== null) {
				index.set(pool.poolId, {
					remainingMicroUsd: pool.remainingMicroUsd,
					expiresAt: pool.expiresAt,
				});
			}
		}
		return index;
	}, [grantPools]);

	const piProviders = useMemo(() => catalog?.providers ?? [], [catalog]);
	const thinkingLevels = useMemo(
		() => catalog?.thinkingLevels ?? [],
		[catalog]
	);

	// The provider rows shown in the picker: every Pi provider except the bare
	// `gateway` pseudo-provider (that IS the Ryu portal local/gateway route). The
	// managed `managed-openrouter` provider IS shown here — as the subscription upsell
	// row when unsubscribed, or the full OpenRouter model list when subscribed.
	//
	// Managed rows are hoisted to the front by a STABLE partition. This is a no-op
	// today (Core's table already leads with the one managed provider) and exists so
	// the pool-backed managed rows land next to it whenever Core publishes them,
	// rather than wherever they happen to fall in the table — they are variants of
	// the same "included with Ryu" route and read as one group.
	const shownProviders = useMemo(() => {
		const visible = piProviders.filter((p) => p.id !== "gateway");
		return [
			...visible.filter((p) => p.managed),
			...visible.filter((p) => !p.managed),
		];
	}, [piProviders]);

	const isRyuActive = agentId === RYU_AGENT_ID;
	// A provider row is the active target when the Ryu agent's Pi config routes to a
	// provider we show; otherwise (gateway / local) the Ryu portal route is active.
	const activeProviderId =
		isRyuActive &&
		config &&
		shownProviders.some((p) => p.id === config.provider)
			? config.provider
			: null;
	const ryuActive = isRyuActive && activeProviderId === null;

	const saveProvider = useCallback(
		(
			providerId: string,
			model: string | null,
			thinkingLevel: string | null
		) => {
			onSelectAgent(RYU_AGENT_ID);
			save({
				provider: providerId,
				model,
				thinkingLevel: thinkingLevel ?? config?.thinkingLevel ?? null,
			}).catch(() => {
				// A failed save leaves the previous config in place; the query
				// invalidation the mutation triggers re-reads ground truth.
			});
		},
		[onSelectAgent, save, config]
	);

	const renderBody = useCallback(
		(close: () => void): ReactNode => {
			const ryuAgent =
				agents.find((a) => a.id === RYU_AGENT_ID) ??
				agents.find((a) => a.recommended) ??
				null;

			const installedExternal = agents.filter(
				(a) => a.transport === "acp" && a.id !== ryuAgent?.id && !a.recommended
			);

			const availableExternal = catalogAgents.agents.filter(
				(e) => !e.added && e.id !== ryuAgent?.id
			);

			const providers: ProviderEntry[] = shownProviders.map((p) => {
				const isActive = activeProviderId === p.id;
				const pool = creditPoolForProvider(p);
				return {
					id: p.id,
					// For a pool-backed row the pool catalog owns the name, not Core:
					// `label` is defined there as the one string a user ever reads for a
					// pool, so the tier stays consistent wherever it is rendered and the
					// supplier behind it stays invisible.
					label: pool ? pool.label : p.label,
					engineKey: providerEngineKey(p.id),
					authKind: p.authKind,
					managed: Boolean(p.managed),
					supportsDiscovery: p.supportsDiscovery !== false,
					// Only the default managed row borrows OpenRouter's catalog (it has no
					// model list of its own and routes there). A pool row enumerates under
					// its OWN id or not at all — inheriting OpenRouter's list would have it
					// advertise models its pool cannot serve.
					discoveryProviderId:
						p.managed && pool === null ? "openrouter" : undefined,
					// A managed row is always `configured` server-side (it is wallet-gated
					// at the Gateway), so the upsell is gated on entitlement, not on
					// `configured`. A pool row adds two escapes: the free-reach pool is the
					// give-it-away tier and must never be upsold, and a user already
					// holding granted credit in this pool has already paid the toll.
					upsell: pool
						? !(
								hasManagedPlan ||
								pool.tier === "free" ||
								grantedPoolIds.has(pool.id)
							)
						: Boolean(p.managed) && !hasManagedPlan,
					upsellCopy: pool ? poolUpsellCopy(pool) : undefined,
					// The pool's own remaining granted credit, shown on the row as "$50.00"
					// so "how much Frontier is left?" is answerable where the choice is
					// made. Looked up by pool id, so a grant row this build can't map back
					// to the catalog contributes nothing rather than landing on the wrong
					// pool — the same rule `grantedPoolIds` applies to the upsell.
					poolGrant: pool ? grantByPoolId.get(pool.id) : undefined,
					// Pooled capacity is Ryu's own, so there is no credential for a user
					// to hold and a pool row is `configured` by definition — the wallet
					// (and the pool's grant balance) is what gates it, at the Gateway.
					// Forced rather than trusted because `configured` comes from Core,
					// where the managed check is still a single-id equality; a pool row
					// that arrived `false` would fall through to the unconfigured branch
					// and offer "Sign in with Ryu Frontier", which is a dead end.
					configured: pool ? true : p.configured,
					isActive,
					currentModel: isActive ? (config?.model ?? null) : null,
					currentThinking: isActive ? (config?.thinkingLevel ?? null) : null,
					modelOverrides: p.modelOverrides,
					// Models the user turned off in Settings are not offered here. The
					// row's own current model is exempt (see `filterEnabledModels`), and
					// the submenu applies the same rule to the live-discovered list.
					models: filterEnabledModels(
						p.suggestedModels.map((m) => ({ id: m, name: m })),
						p.modelOverrides,
						isActive ? config?.model : null
					),
				};
			});

			const teamEntries: TeamEntry[] = teams.map((t) => ({
				id: t.id,
				name: t.name,
				isActive: teamId === t.id,
				engines: t.members.map((id) => {
					const member = agents.find((a) => a.id === id);
					return member ? engineForAgent(member) : null;
				}),
			}));

			const data: UniversalPickerData = {
				activeAgentId: agentId,
				agents,
				activeModelSection,
				activeExtraSections,
				ryuAgent,
				ryuActive,
				providers,
				installedExternal,
				availableExternal,
				installPendingId: catalogAgents.pendingId,
				teams: teamEntries,
				thinkingLevels,
				onSelectAgent: (id) => onSelectAgent(id),
				onSelectTeam: onSelectTeam ? (id) => onSelectTeam(id) : undefined,
				onCreateAgent,
				onInstallExternal: (id) => {
					catalogAgents.install(id).catch(() => {
						// Install errors surface via the catalog hook's error state.
					});
				},
				onConfigureAuto: () => openAgentAutoConfig(),
				onConfigureCredentials: () => openGateway("providers"),
				onUpgrade: () => requestUpgrade(),
				onUseProvider: (providerId) => {
					const p = providers.find((x) => x.id === providerId);
					saveProvider(
						providerId,
						p?.currentModel ?? p?.models[0]?.id ?? null,
						null
					);
				},
				onSelectProviderModel: (providerId, modelId) =>
					saveProvider(providerId, modelId, null),
				onSelectProviderThinking: (providerId, level) => {
					const p = providers.find((x) => x.id === providerId);
					saveProvider(
						providerId,
						p?.currentModel ?? p?.models[0]?.id ?? null,
						level
					);
				},
			};

			return createElement(UniversalPickerBody, { data, close });
		},
		[
			agents,
			agentId,
			activeModelSection,
			activeExtraSections,
			ryuActive,
			activeProviderId,
			shownProviders,
			hasManagedPlan,
			grantedPoolIds,
			thinkingLevels,
			config,
			teams,
			teamId,
			catalogAgents,
			onSelectAgent,
			onSelectTeam,
			onCreateAgent,
			openGateway,
			openAgentAutoConfig,
			requestUpgrade,
			saveProvider,
		]
	);

	return { renderBody };
}
