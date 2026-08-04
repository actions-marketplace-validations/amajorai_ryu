// packages/marketplace/src/catalog/detail/detail-panels.tsx
//
// The remaining detail tabs — README, Versions, Dependencies — plus the metadata
// strip that sits under the listing's name.
//
// These are deliberately small and data-shaped. Each renders exactly what the
// catalog reported and says so plainly when a source reported nothing, rather
// than fabricating a plausible-looking blank ("0 downloads" for a source that
// does not count downloads is a lie, "not reported" is not).

import {
	Calendar01Icon,
	ComputerIcon,
	Download01Icon,
	Link01Icon,
	SquareLock01Icon,
	Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@ryu/ui/components/badge.tsx";
import type { ComponentType } from "react";
import { useState } from "react";
import { grantDescription, grantLabel } from "../grant-labels.ts";
import { safeHttpUrl } from "../safe-url.ts";
import { surfaceLabel } from "../surface-labels.ts";
import type {
	CatalogEntry,
	PluginCatalogDetail,
	VersionSnapshot,
} from "../types.ts";
import { RequiredPluginsSection } from "./dependency-graph.tsx";

/** Render an ISO timestamp as a short absolute date. Absolute rather than
 *  relative on purpose: "2 years ago" is the health tab's job, a version table
 *  wants the date it actually shipped. */
export function formatDate(iso?: string | null): string | null {
	if (!iso) {
		return null;
	}
	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) {
		return null;
	}
	return parsed.toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

/** Compact download counts (12400 → "12.4k") — a store column, not an analytics
 *  readout. */
export function formatCount(value: number): string {
	if (value < 1000) {
		return String(value);
	}
	if (value < 1_000_000) {
		return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
	}
	return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** One item in the strip under the listing name. */
function MetaItem({
	icon,
	label,
	value,
}: {
	icon: typeof Tag01Icon;
	label: string;
	value: string;
}) {
	return (
		<span
			className="inline-flex items-center gap-1.5 text-muted-foreground text-xs"
			title={label}
		>
			<HugeiconsIcon className="size-3.5" icon={icon} />
			{value}
		</span>
	);
}

/**
 * The metadata strip: current version, when it last changed, how many times it
 * has been downloaded, and which surfaces it runs on.
 *
 * Every item is conditional. A listing that reports none of them renders nothing
 * at all rather than a row of dashes.
 */
export function DetailMetaStrip({
	detail,
	entry,
}: {
	detail: PluginCatalogDetail | null;
	entry: CatalogEntry;
}) {
	const version = detail?.version ?? entry.version ?? null;
	const updated = formatDate(detail?.updatedAt);
	const created = formatDate(detail?.createdAt);
	const downloads = detail?.downloads ?? null;
	// Fall back to the CARD's surfaces when the detail fetch has not landed (or the
	// source serves no detail at all). This is load-bearing now that the card no
	// longer shows the badges itself: without the fallback, "which platforms does
	// this run on?" would be unanswerable anywhere for a descriptor-only listing.
	const surfaces = detail?.surfaces ?? entry.surfaces ?? [];

	const items = [
		version
			? {
					icon: Tag01Icon,
					label: "Current version",
					value: `v${version.replace(/^v/, "")}`,
				}
			: null,
		updated
			? {
					icon: Calendar01Icon,
					label: "Last updated",
					value: `Updated ${updated}`,
				}
			: null,
		created
			? {
					icon: Calendar01Icon,
					label: "First published",
					value: `Created ${created}`,
				}
			: null,
		typeof downloads === "number"
			? {
					icon: Download01Icon,
					label: "Downloads",
					value: `${formatCount(downloads)} downloads`,
				}
			: null,
	].filter(Boolean) as {
		icon: typeof Tag01Icon;
		label: string;
		value: string;
	}[];

	if (items.length === 0 && surfaces.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
			{items.map((item) => (
				<MetaItem
					icon={item.icon}
					key={item.label}
					label={item.label}
					value={item.value}
				/>
			))}
			{surfaces.length > 0 ? (
				<span className="inline-flex items-center gap-1.5">
					<HugeiconsIcon
						className="size-3.5 text-muted-foreground"
						icon={ComputerIcon}
					/>
					{surfaces.map((surface) => (
						<Badge className="text-xs" key={surface} variant="outline">
							{surfaceLabel(surface)}
						</Badge>
					))}
				</span>
			) : null}
		</div>
	);
}

/** The README tab. Markdown rendering crosses the host seam (desktop renders
 *  with Streamdown, web with react-markdown), so the component is passed in. */
export function ReadmePanel({
	Markdown,
	readme,
	readmeUrl,
}: {
	Markdown: ComponentType<{ className?: string; content: string }>;
	readme: string;
	readmeUrl?: string | null;
}) {
	const href = safeHttpUrl(readmeUrl);
	return (
		<div className="flex flex-col gap-3">
			<Markdown
				className="prose prose-sm dark:prose-invert max-w-none"
				content={readme}
			/>
			{href ? (
				<a
					className="inline-flex items-center gap-1.5 text-muted-foreground text-xs hover:underline"
					href={href}
					rel="noopener noreferrer"
					target="_blank"
				>
					<HugeiconsIcon className="size-3.5" icon={Link01Icon} />
					Read the original
				</a>
			) : null}
		</div>
	);
}

/** The Versions tab: published version history, newest first. */
/** One version row's expandable "as published" snapshot.
 *
 *  Fetched lazily on expand, never up front: a listing can carry 20 versions and
 *  eagerly reading each one's manifest and README would be 40 network round-trips
 *  to render a tab nobody may open. */
function VersionSnapshotRow({
	tag,
	fetchVersionDetail,
}: {
	tag: string;
	fetchVersionDetail: (tag: string) => Promise<VersionSnapshot | null>;
}) {
	const [state, setState] = useState<
		| { status: "idle" }
		| { status: "loading" }
		| { status: "empty" }
		| { status: "ready"; snapshot: VersionSnapshot }
	>({ status: "idle" });

	const load = async () => {
		if (state.status !== "idle") {
			return;
		}
		setState({ status: "loading" });
		try {
			const snapshot = await fetchVersionDetail(tag);
			setState(snapshot ? { snapshot, status: "ready" } : { status: "empty" });
		} catch {
			// A tag with no readable manifest is the NORMAL case for tags predating
			// the listing being packaged — not an error worth shouting about.
			setState({ status: "empty" });
		}
	};

	if (state.status === "idle") {
		return (
			<button
				className="mt-1 text-muted-foreground text-xs hover:underline"
				onClick={load}
				type="button"
			>
				Show what shipped in this version
			</button>
		);
	}
	if (state.status === "loading") {
		return <p className="mt-1 text-muted-foreground text-xs">Reading tag…</p>;
	}
	if (state.status === "empty") {
		return (
			<p className="mt-1 text-muted-foreground text-xs">
				No manifest published at this tag.
			</p>
		);
	}

	const { snapshot } = state;
	const facts = [
		snapshot.description ? `“${snapshot.description}”` : null,
		snapshot.license ? `Licence: ${snapshot.license}` : null,
		snapshot.engines?.ryu ? `Requires Ryu ${snapshot.engines.ryu}` : null,
		snapshot.readme
			? `README: ${Math.round(snapshot.readme.length / 100) / 10}k chars`
			: "No README at this tag",
	].filter(Boolean) as string[];

	return (
		<div className="mt-2 flex flex-col gap-1 rounded-md bg-muted/40 px-2.5 py-2">
			{facts.map((fact) => (
				<p className="text-muted-foreground text-xs leading-relaxed" key={fact}>
					{fact}
				</p>
			))}
			{/* The honesty line. Only repo-resident signals are historical; stars,
			    issues and the archived flag are reported as of NOW and cannot be
			    reconstructed for a past tag, so this panel must never imply it is
			    showing a full health grade for that version. */}
			<p className="text-[11px] text-muted-foreground/70 leading-relaxed">
				Read from the repository at this tag. Repository stats (stars, issues,
				activity) always reflect today, not this release.
			</p>
		</div>
	);
}

export function VersionsPanel({
	versions,
	fetchVersionDetail,
}: {
	versions: NonNullable<PluginCatalogDetail["versions"]>;
	/** Host-supplied reader for one version's snapshot. Injected because this
	 *  package is host-agnostic — the desktop talks to Core, the web host has no
	 *  such endpoint and simply omits it, which hides the affordance entirely. */
	fetchVersionDetail?: (tag: string) => Promise<VersionSnapshot | null>;
}) {
	return (
		<ul className="flex flex-col gap-1.5">
			{versions.map((version, index) => {
				const href = safeHttpUrl(version.url);
				const published = formatDate(version.publishedAt);
				return (
					<li className="rounded-md border px-3 py-2" key={version.version}>
						<div className="flex flex-wrap items-baseline gap-2">
							<span className="font-medium font-mono text-sm">
								{version.version}
							</span>
							{index === 0 ? (
								<Badge className="text-xs" variant="secondary">
									Current
								</Badge>
							) : null}
							{version.prerelease ? (
								<Badge className="text-xs" variant="outline">
									Pre-release
								</Badge>
							) : null}
							{version.tagOnly ? (
								<Badge className="text-xs" variant="outline">
									Tag only
								</Badge>
							) : null}
							<span className="ml-auto flex items-center gap-3 text-muted-foreground text-xs">
								{typeof version.downloads === "number" &&
								version.downloads > 0 ? (
									<span>{formatCount(version.downloads)} downloads</span>
								) : null}
								{published ? <span>{published}</span> : null}
							</span>
						</div>
						{version.notes ? (
							<p className="mt-1 whitespace-pre-wrap text-muted-foreground text-xs leading-relaxed">
								{version.notes}
							</p>
						) : null}
						{href ? (
							<a
								className="mt-1 inline-block text-muted-foreground text-xs hover:underline"
								href={href}
								rel="noopener noreferrer"
								target="_blank"
							>
								View release
							</a>
						) : null}
						{fetchVersionDetail ? (
							<div>
								<VersionSnapshotRow
									fetchVersionDetail={fetchVersionDetail}
									tag={version.version}
								/>
							</div>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}

/** True when there is anything to put on a Dependencies tab. */
export function hasDependencies(
	detail: PluginCatalogDetail | null,
	entry: CatalogEntry
): boolean {
	const requires = detail?.requires ?? entry.requires ?? null;
	return Boolean(
		requires?.apps?.length ||
			requires?.grants?.length ||
			detail?.permissionGrants?.length ||
			detail?.engines?.ryu ||
			detail?.apiSurface?.provides?.length
	);
}

/**
 * The Dependencies tab: what must be present for this plugin to work.
 *
 * Three different kinds of dependency live here on purpose — other plugins, the
 * permissions it needs granted, and the Core version it needs — because from the
 * reader's side they are the same question: what else does installing this drag
 * in?
 */
export function DependenciesPanel({
	detail,
	entry,
}: {
	detail: PluginCatalogDetail | null;
	entry: CatalogEntry;
}) {
	const requires = detail?.requires ?? entry.requires ?? null;
	const apps = requires?.apps ?? [];
	const grants = detail?.permissionGrants?.length
		? detail.permissionGrants
		: (requires?.grants ?? []);
	const engineReq = detail?.engines?.ryu ?? null;

	return (
		<div className="flex flex-col gap-6">
			{/* Resolves the declared ids into the tree Core walks, with each entry's
			    live install/enable state when the host can supply it — see
			    dependency-graph.tsx. Renders nothing when nothing is declared. */}
			<RequiredPluginsSection
				apps={apps}
				subjectId={entry.id}
				subjectName={entry.name}
			/>

			{grants.length > 0 ? (
				<section className="flex flex-col gap-2">
					<h3 className="flex items-center gap-1.5 font-medium text-sm">
						<HugeiconsIcon
							className="size-4 text-muted-foreground"
							icon={SquareLock01Icon}
						/>
						Requires these permissions
					</h3>
					<ul className="flex flex-col gap-1.5">
						{grants.map((grant) => (
							<li className="rounded-md border px-3 py-2" key={grant}>
								<div className="flex items-baseline justify-between gap-3">
									<span className="min-w-0 truncate text-sm">
										{grantLabel(grant)}
									</span>
									<code className="shrink-0 truncate font-mono text-muted-foreground text-xs">
										{grant}
									</code>
								</div>
								<p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
									{grantDescription(grant)}
								</p>
							</li>
						))}
					</ul>
				</section>
			) : null}

			{engineReq ? (
				<section className="flex flex-col gap-2">
					<h3 className="font-medium text-sm">Requires Ryu</h3>
					<p className="text-muted-foreground text-sm">
						This plugin declares it needs Ryu{" "}
						<code className="font-mono">{engineReq}</code>. An incompatible node
						refuses to load it rather than failing at runtime.
					</p>
				</section>
			) : null}

			{detail?.apiSurface?.provides?.length ? (
				<section className="flex flex-col gap-2">
					<h3 className="font-medium text-sm">Provides to other plugins</h3>
					<ul className="flex flex-col gap-1.5">
						{detail.apiSurface.provides.map((entryProvides) => (
							<li
								className="rounded-md border px-3 py-2 text-sm"
								key={entryProvides.capability}
							>
								<code className="font-mono">{entryProvides.capability}</code>
							</li>
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}
