// apps/desktop/src/components/store/catalog-host.tsx
//
// Desktop binding for the shared @ryu/marketplace catalog sections (apps / models
// / skills). Supplies the Core-node-scoped data hooks, the install-progress
// button, the app Markdown renderer, and Tauri's `openExternal` through the
// CatalogHost seam. `navigate` deep-links into a new tab, which the shared Skills
// section pairs with `canAuthorSkills` to unlock its SKILL.md authoring UI, and the
// Models section uses for the "Fine-tune this model" handoff. The hook functions the
// host carries are stable module refs, so the section's `host.use*Catalog(...)` call
// resolves to the same hook every render (rules of hooks); only `navigate` and the
// authoring bit re-key the memoized host. Web mounts its own read-only host with
// `install: null`.

import { Markdown } from "@ryu/blocks/desktop/agent-elements/markdown.tsx";
import { InstallProgressButton } from "@ryu/blocks/desktop/install-button.tsx";
import { fitStyle } from "@ryu/blocks/desktop/model-catalog.tsx";
import { DependencyLookupProvider } from "@ryu/marketplace/catalog/detail/dependency-graph";
import {
	type CatalogHost,
	CatalogHostProvider,
	type CatalogInstallButtonProps,
	type CatalogNode,
} from "@ryu/marketplace/catalog/host";
import type { InstalledModelEntry } from "@ryu/marketplace/catalog/types";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo } from "react";
import { openExternal } from "@/lib/tauri-bridge.ts";
import { ActiveModelControl } from "@/src/components/store/ActiveModelControl.tsx";
import { useDesktopDependencyLookup } from "@/src/components/store/dependency-lookup.ts";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { SKILL_EDITOR_ALIAS } from "@/src/contributions/companion-alias.ts";
import { useCompanionAlias } from "@/src/contributions/use-companion-alias.ts";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { useAppsCatalog } from "@/src/hooks/useAppsCatalog.ts";
import { useModelCatalog } from "@/src/hooks/useModelCatalog.ts";
import { usePersistedToggle } from "@/src/hooks/usePersistedToggle.ts";
import { usePluginSettingsOpener } from "@/src/hooks/usePluginSettingsOpener.ts";
import { useSkillsCatalog } from "@/src/hooks/useSkillsCatalog.ts";
import type { DownloadKind } from "@/src/lib/api/downloads.ts";
import { estimateLlmfit, listInstalledModels } from "@/src/lib/api/models.ts";
import { fetchPluginVersionDetail } from "@/src/lib/api/plugins.ts";
import { installSidecar } from "@/src/lib/services-api.ts";
import { useInstallProgress } from "@/src/store/useDownloadsStore.ts";
import { useInstallingLookup } from "@/src/store/useInstallStore.ts";

/** The install button the shared sections render, wired to the desktop downloads
 *  store: it looks up the live percent for the item and renders the progress
 *  button. Kept out of the shared package so no catalog component imports the
 *  desktop store directly. */
function DesktopInstallButton({
	installing,
	onClick,
	children,
	progress,
	disabled,
	idleVariant,
	busyLabel,
}: CatalogInstallButtonProps) {
	const { percent } = useInstallProgress(
		progress.kinds as DownloadKind[],
		progress.name,
		progress.taskId
	);
	return (
		<InstallProgressButton
			busyLabel={busyLabel}
			disabled={disabled}
			idleVariant={idleVariant}
			installing={installing}
			onClick={onClick}
			percent={percent}
		>
			{children}
		</InstallProgressButton>
	);
}

/** The desktop's shared install state, exposed to the shared sections through the
 *  install seam. Module-level (like {@link DesktopInstallButton}) so the memoized
 *  host never hands the sections a new hook identity on a node switch. */
const desktopInstall = {
	InstallButton: DesktopInstallButton,
	useInstallingLookup,
};

/** Active node identity, normalized to the shared seam's `{url, token}` shape. */
function useCatalogNode(): CatalogNode {
	const node = useActiveNode();
	return { url: node.url, token: node.token ?? null };
}

/** Installed models by stem for the active node (fine-tuned-variants list). */
function useInstalledModels(): InstalledModelEntry[] {
	const node = useActiveNode();
	const query = useQuery({
		queryKey: ["models", "installed", node.url],
		queryFn: () =>
			listInstalledModels({ url: node.url, token: node.token ?? null }),
	});
	return query.data ?? [];
}

/** Mount once above every store surface that renders the shared catalog sections. */
export function DesktopCatalogHost({ children }: { children: ReactNode }) {
	const activeNode = useCatalogNode();
	const { openTab } = useTabsContext();
	const navigate = useCallback(
		(path: string) => {
			openTab(path);
		},
		[openTab]
	);

	// Whether the SKILL.md editor app is live. `navigate` alone only proves desktop
	// CAN open a tab; `@ryu/skill-editor` ships default-OFF, so without this the
	// Skills section rendered New/Edit on every card and each opened "App not
	// enabled". Read from the live contributions feed — the same source the
	// `/skills/new` + `/skills/:id/edit` routes mount from — so the button and the
	// page it opens can never disagree.
	const skillEditorOwner = useCompanionAlias(SKILL_EDITOR_ALIAS);

	// Node-scoped answer to "is this dependency already here?", read by the shared
	// Dependencies tab through its own context rather than the host object: the
	// host must stay a stable module-shaped value (rules of hooks), and this is
	// live query data that changes as apps are installed and enabled.
	const dependencyLookup = useDesktopDependencyLookup();

	const host = useMemo<CatalogHost>(
		() => ({
			canAuthorSkills: skillEditorOwner !== null,
			install: desktopInstall,
			Markdown,
			// Reads the listing's repo at a version tag. Bound to the active node
			// here so the shared panel stays node-agnostic, matching how
			// `estimateLlmfit` is bound below.
			fetchVersionDetail: (repo: string, tag: string) =>
				fetchPluginVersionDetail(
					{ url: activeNode.url, token: activeNode.token },
					repo,
					tag
				),
			navigate,
			openExternal,
			useAppsCatalog,
			useSkillsCatalog,
			useModelCatalog,
			useActiveNode: useCatalogNode,
			usePersistedToggle,
			// Lets a Store listing lead to its own settings tab (Gateway dialog for
			// node-scoped tabs, App Settings for user-scoped ones) instead of leaving
			// the user to find it. Web omits this and the affordance never renders.
			usePluginSettingsOpener,
			installSidecar,
			estimateLlmfit: (node, repo) =>
				estimateLlmfit({ url: node.url, token: node.token }, repo),
			useInstalledModels,
			ActiveModelControl,
			fitStyle,
		}),
		// activeNode is a dep because fetchVersionDetail closes over it — without
		// it, switching nodes would keep reading versions from the previous one.
		[navigate, skillEditorOwner, activeNode.url, activeNode.token]
	);

	return (
		<CatalogHostProvider host={host}>
			{/* Lets the Dependencies tab resolve declared ids against THIS node —
			    names, install/enable state, and each dependency's own dependencies.
			    Web mounts no lookup, so its tab degrades to the declared list. */}
			<DependencyLookupProvider lookup={dependencyLookup}>
				{children}
			</DependencyLookupProvider>
		</CatalogHostProvider>
	);
}
