// packages/marketplace/src/catalog/host.tsx
//
// The host-services seam for the shared catalog sections (apps / models / skills).
// These sections are Core-node-scoped master-detail browsers with an
// install→enable lifecycle on desktop, and read-only "open in Ryu" browsers on
// web. Everything that differs between the two surfaces crosses this seam:
//
//   - the per-realm data hook (desktop passes its real react-query hook; web
//     passes an adapter that fabricates the same shape from federated data),
//   - the install layer (`install`) — the desktop install/progress button, or
//     `null` on web, which flips every install/enable/lifecycle touchpoint off,
//   - `renderAffordance` — what to render where the install button would be when
//     `install` is null (web: an "Open in Ryu" deep-link button).
//
// The host value MUST be a stable module const on each surface so the hooks it
// carries keep a consistent identity across renders (rules of hooks). This is a
// separate context from MarketplaceHost (the money layer): the two have different
// consumers, but a surface mounts both above its store.

import {
	type ComponentType,
	createContext,
	type ReactNode,
	useContext,
} from "react";
import type {
	AppsCatalogState,
	InstalledModelEntry,
	LlmFitEstimate,
	ModelCatalogState,
	SkillsCatalogState,
	VersionSnapshot,
} from "./types.ts";

/** Which realm an affordance target belongs to (drives the web deep-link page). */
export type CatalogRealm = "app" | "model" | "skill";

/** Minimal identity of the item an affordance is rendered for. */
export interface CatalogAffordanceTarget {
	id: string;
	name: string;
	realm: CatalogRealm;
}

/** Props for the host-provided install button. The host encapsulates the live
 *  download-progress lookup (keyed by {@link progress}) so the shared sections
 *  never import the desktop downloads store. */
export interface CatalogInstallButtonProps {
	/** Label beside the spinner while installing (a known percent replaces it). */
	busyLabel?: string;
	children: ReactNode;
	/** Disable the idle button (e.g. an incompatible / too-big model file). */
	disabled?: boolean;
	/** Variant used at rest (the busy state always renders the progress fill). */
	idleVariant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
	installing: boolean;
	onClick: () => void;
	/** Identity for the progress lookup: download kinds + display name/id. */
	progress: { kinds: string[]; name: string };
}

/** Minimal node identity a model detail action needs to reach Core. */
export interface CatalogNode {
	token: string | null;
	url: string;
}

/** The install layer a surface provides, or `null` for a read-only surface. */
export interface CatalogInstall {
	InstallButton: ComponentType<CatalogInstallButtonProps>;
}

/** Resolves a plugin id to a "reveal its settings" action, or `null` when that
 *  plugin has no settings destination on this surface. */
export type PluginSettingsOpener = (
	pluginId: string
) => (() => void) | null | undefined;

/** Stable "nothing is configurable here" resolver. Module-level so a surface
 *  without {@link CatalogHost.usePluginSettingsOpener} keeps the same identity
 *  every render and the fallback hook call stays rules-of-hooks clean. */
const NO_SETTINGS_OPENER: PluginSettingsOpener = () => null;

/** Fallback for {@link CatalogHost.usePluginSettingsOpener} on a host that omits
 *  it (web). A hook by shape so call sites can pick one or the other and still
 *  make exactly one hook call per render. */
export function useNoSettingsOpener(): PluginSettingsOpener {
	return NO_SETTINGS_OPENER;
}

/** Props for the host-provided Markdown renderer. The two surfaces render skill
 *  READMEs / bundled files through their own Markdown component (desktop:
 *  Streamdown; web: react-markdown), so the shared sections never pick one. */
export interface CatalogMarkdownProps {
	className?: string;
	content: string;
}

/** The full set of services the shared catalog sections need from their host. */
export interface CatalogHost {
	/** The "Use this model" control for an installed model (desktop-only; a
	 *  read-only surface renders nothing since installed cards never appear). */
	ActiveModelControl: ComponentType<{ repoId: string }>;
	/** Whether the SKILL.md authoring routes actually resolve on this surface.
	 *
	 *  {@link navigate} says the host CAN deep-link; this says the deep link LANDS
	 *  somewhere. The two came apart because the editor is a Ryu App
	 *  (`@ryu/skill-editor`) that ships default-OFF: desktop always has
	 *  `navigate`, so it rendered New/Edit on every card, and each one opened a tab
	 *  reading "App not enabled". A host that owns the editor should compute this
	 *  from whatever tells it the app is live (desktop: the contributions feed), not
	 *  from a baked plugin id.
	 *
	 *  Omitted ⇒ treated as `true`, so a host with no notion of app enablement keeps
	 *  its old behaviour and only `navigate` gates authoring. */
	canAuthorSkills?: boolean;
	/** On-demand llmfit hardware fit + tok/s estimate for one repo. */
	estimateLlmfit: (node: CatalogNode, repo: string) => Promise<LlmFitEstimate>;
	/** Read a listing as it stood at one published version's tag.
	 *
	 *  Optional because it is genuinely host-specific: the desktop asks its node,
	 *  and a read-only web surface has no such endpoint. Omitting it hides the
	 *  affordance entirely rather than offering an expander that cannot resolve. */
	fetchVersionDetail?: (
		repo: string,
		tag: string
	) => Promise<VersionSnapshot | null>;
	/** Tailwind classes + dot color for a device-fit verdict. */
	fitStyle: (fit: string) => { className: string; dot: string };
	/** The install layer, or `null` on read-only surfaces (web). When null the
	 *  sections hide every install/enable/lifecycle/source affordance and render
	 *  {@link renderAffordance} in the primary-action slot instead. */
	install: CatalogInstall | null;
	/** Point-of-use install of an optional Core sidecar (e.g. `llmfit`). */
	installSidecar: (
		url: string,
		token: string | null,
		name: string
	) => Promise<unknown>;
	/** The surface's Markdown renderer, used for skill READMEs + bundled files. */
	Markdown: ComponentType<CatalogMarkdownProps>;
	/** Deep-link to an in-app route (desktop: open a tab). Its presence gates the
	 *  authoring UI (New/Edit skill) — a read-only surface (web) omits it. */
	navigate?: (path: string) => void;
	/** Open an external URL (Tauri shell on desktop, navigation on web). */
	openExternal: (url: string) => Promise<void> | void;
	/** Read-only primary affordance, rendered where the install button would be
	 *  when {@link install} is null (web: an "Open in Ryu" button). */
	renderAffordance?: (target: CatalogAffordanceTarget) => ReactNode;
	/** Active Core node identity (url + token). Read-only surfaces return a stub;
	 *  the model detail's node-coupled extras (llmfit, fine-tunes, active-model) are
	 *  gated behind {@link install} anyway, so a stub is never actually dereferenced. */
	useActiveNode: () => CatalogNode;
	/** The surface's Apps (plugins) catalog hook (called at component top level).
	 *  `options.origin` selects which slice of the catalog to fetch: omitted =
	 *  the first-party catalog; `"community"` = the GitHub topic-discovered feed.
	 *  It is a FETCH selector, not a client-side filter — unreviewed listings are
	 *  never in the first-party pages, so they can't be filtered out of them. */
	useAppsCatalog: (
		initialQuery: string,
		options?: { origin?: "community" }
	) => AppsCatalogState;
	/** Installed models by stem (drives the "Your fine-tuned versions" list). */
	useInstalledModels: () => InstalledModelEntry[];
	/** The surface's Models catalog hook (called at component top level). */
	useModelCatalog: (initialQuery: string) => ModelCatalogState;
	/** A persisted boolean toggle synced across consumers (e.g. "Show tags"). */
	usePersistedToggle: (
		key: string,
		defaultValue: boolean
	) => [boolean, (v: boolean) => void];
	/** Resolve "where is this plugin configured?" into an opener.
	 *
	 *  A hook (called ONCE per section, its resolver threaded down to the cards) so
	 *  the host can read live state — which plugins declare settings, at which
	 *  scope — without every card refetching it. The resolver returns `null` for a
	 *  plugin with no settings destination, and the Settings affordance then does
	 *  not render, so an item that can't be configured never offers to be.
	 *
	 *  Omitted by read-only surfaces (web has no settings dialog to open); the
	 *  sections fall back to {@link useNoSettingsOpener}. */
	usePluginSettingsOpener?: () => PluginSettingsOpener;
	/** The surface's Skills catalog hook (called at component top level). */
	useSkillsCatalog: (initialQuery: string) => SkillsCatalogState;
}

const CatalogHostContext = createContext<CatalogHost | null>(null);

export function CatalogHostProvider({
	host,
	children,
}: {
	host: CatalogHost;
	children: ReactNode;
}) {
	return (
		<CatalogHostContext.Provider value={host}>
			{children}
		</CatalogHostContext.Provider>
	);
}

/** Read the injected catalog host services. Throws if no provider is mounted. */
export function useCatalogHost(): CatalogHost {
	const host = useContext(CatalogHostContext);
	if (!host) {
		throw new Error(
			"useCatalogHost must be used within a <CatalogHostProvider>."
		);
	}
	return host;
}
