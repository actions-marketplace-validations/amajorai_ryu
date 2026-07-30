import { Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@ryu/ui/components/badge.tsx";
import { Button } from "@ryu/ui/components/button.tsx";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemSeparator,
	ItemTitle,
} from "@ryu/ui/components/item.tsx";
import { toast } from "@ryu/ui/components/sileo.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	describeApiRefusal,
	fetchParseBackends,
	fetchParseCapability,
	type ParseBackend,
	type ParseBackendList,
	type ParseCapability,
	setParseBackend,
} from "@/src/lib/api/documents.ts";
import { formatBytes, SPACE_UPLOAD_MAX_BYTES } from "@/src/lib/api/spaces.ts";

/**
 * NODE-scoped settings for `document.parse`: which app extracts text from
 * uploaded documents, and the node's upload ceilings.
 *
 * Node-scoped is not a filing decision. One provider is bound per node and it
 * serves every Space and every chat attachment on it, so putting this in the
 * per-user App Settings dialog would imply a per-user choice that does not
 * exist. It renders in the Gateway dialog, next to the other node settings.
 *
 * The extractor is a CAPABILITY, not a Rust trait — several apps can provide it
 * and Core resolves one with `user override > sole provider > declared default >
 * lowest id`. This panel owns exactly the first rung.
 */
export function DocumentParsingSettings() {
	const node = useActiveNode();
	const nodeUrl = node.url;
	const nodeToken = node.token ?? null;

	const [backends, setBackends] = useState<ParseBackendList | null>(null);
	const [capability, setCapability] = useState<ParseCapability | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		const target: ApiTarget = { url: nodeUrl, token: nodeToken };
		setLoading(true);
		try {
			setBackends(await fetchParseBackends(target));
		} catch {
			setBackends(null);
		}
		try {
			// A separate, failure-tolerant read: this one probes the bound sidecar
			// (2s, and it never wakes a sleeping one), so it is allowed to come back
			// empty without taking the picker down with it.
			setCapability(await fetchParseCapability(target));
		} catch {
			setCapability(null);
		}
		setLoading(false);
	}, [nodeUrl, nodeToken]);

	useEffect(() => {
		refresh().catch(() => undefined);
	}, [refresh]);

	const bind = useCallback(
		async (backendId: string | null) => {
			setBusy(true);
			try {
				await setParseBackend({ url: nodeUrl, token: nodeToken }, backendId);
				toast.success(
					backendId
						? "Parser changed — re-parse a Space to apply it to existing files"
						: "Parser reset to the automatic pick"
				);
				await refresh();
			} catch (e) {
				toast.error({
					title: "Couldn't change the parser",
					// Core answers 409 with WHICH enabled app the change would leave
					// unbound. That reason is in the body, not in `ApiError.message`.
					description: describeApiRefusal(e),
				});
			} finally {
				setBusy(false);
			}
		},
		[nodeUrl, nodeToken, refresh]
	);

	if (loading && !backends) {
		return (
			<div className="flex h-24 items-center justify-center rounded-lg bg-muted/40">
				<Spinner />
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<ParserBackendCard
				backends={backends}
				busy={busy}
				capability={capability}
				onBind={bind}
				onRefresh={() => {
					refresh().catch(() => undefined);
				}}
			/>
			<UploadLimitsCard capability={capability} />
		</div>
	);
}

/** Bound / default markers for one provider row. */
function ProviderBadges({
	backend,
	bound,
}: {
	backend: ParseBackend;
	bound: string | null;
}) {
	return (
		<>
			{bound === backend.id ? <Badge>Bound</Badge> : null}
			{backend.isDefault ? <Badge variant="secondary">Default</Badge> : null}
		</>
	);
}

function ParserBackendCard({
	backends,
	capability,
	busy,
	onBind,
	onRefresh,
}: {
	backends: ParseBackendList | null;
	busy: boolean;
	capability: ParseCapability | null;
	onBind: (backendId: string | null) => Promise<void>;
	onRefresh: () => void;
}) {
	const providers = backends?.providers ?? [];
	const notEnabled = backends?.available ?? [];
	const bound = backends?.bound ?? null;
	const builtin = backends?.builtinExtensions ?? [];

	return (
		<div className="space-y-4 rounded-lg bg-muted/40 p-4">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="font-medium text-sm">Document parser</p>
					<p className="text-muted-foreground text-xs">
						Which app turns an uploaded PDF, Word file or spreadsheet into text
						an agent can read. Node-wide: this one choice serves every Space and
						every chat attachment.
					</p>
				</div>
				<Button disabled={busy} onClick={onRefresh} size="sm" variant="ghost">
					<HugeiconsIcon className="size-4" icon={Refresh01Icon} />
					Refresh
				</Button>
			</div>

			{/* The floor, stated unconditionally. "No parser installed" is not the
			    same as "this node cannot read anything", and the difference is the
			    whole reason a heavy Python install stays optional. */}
			<p className="text-muted-foreground text-xs">
				Without any parser this node still reads{" "}
				{builtin.length > 0
					? builtin.join(", ")
					: "plain text, Markdown, CSV, JSON and HTML"}{" "}
				on its own. Heavier formats need a parser app, installed from the Store.
			</p>

			{providers.length === 0 ? (
				<p className="rounded-md border border-dashed px-3 py-2.5 text-muted-foreground text-sm">
					No document parser is enabled on this node. Install one from the Store
					(MarkItDown, Docling, Unstructured), then come back here to pick it.
				</p>
			) : (
				<ItemGroup className="overflow-hidden rounded-lg bg-background shadow-none">
					{providers.map((backend, index) => (
						<Fragment key={backend.id}>
							{index > 0 ? <ItemSeparator /> : null}
							<Item className="justify-between" size="sm">
								<ItemContent>
									<ItemTitle className="flex items-center gap-2">
										{backend.name}
										<ProviderBadges backend={backend} bound={bound} />
									</ItemTitle>
									<ItemDescription>
										{backend.id}
										{backend.version ? ` · v${backend.version}` : ""}
									</ItemDescription>
								</ItemContent>
								<ItemActions>
									<Button
										disabled={busy || bound === backend.id}
										onClick={() => {
											onBind(backend.id).catch(() => undefined);
										}}
										size="sm"
										variant={bound === backend.id ? "ghost" : "outline"}
									>
										{bound === backend.id ? "In use" : "Use"}
									</Button>
								</ItemActions>
							</Item>
						</Fragment>
					))}
				</ItemGroup>
			)}

			{/* Selectability requires unanimity across providers, so this can be
			    false with several installed. Saying so beats a picker that silently
			    does nothing. */}
			{providers.length > 1 && backends && !backends.selectable ? (
				<p className="text-muted-foreground text-xs">
					These parsers cannot be swapped: one of them does not declare itself
					selectable, so the capability does not resolve to a single choice.
				</p>
			) : null}

			{backends?.overridden ? (
				<Button
					disabled={busy}
					onClick={() => {
						onBind(null).catch(() => undefined);
					}}
					size="sm"
					variant="outline"
				>
					Reset to automatic
				</Button>
			) : null}

			{notEnabled.length > 0 ? (
				<div className="space-y-1">
					<p className="font-medium text-xs">Installed but turned off</p>
					<ul className="space-y-1">
						{notEnabled.map((backend) => (
							<li className="text-muted-foreground text-xs" key={backend.id}>
								{backend.name} ({backend.id}) — enable it in the Store to make
								it selectable here.
							</li>
						))}
					</ul>
				</div>
			) : null}

			{capability?.provider ? (
				<CapabilityReadout capability={capability} />
			) : null}

			<p className="text-muted-foreground text-xs">
				Changing the parser does not re-read files that are already stored. Open
				a Space and use <strong>Re-parse all</strong> to apply the new backend
				to what is already there.
			</p>
		</div>
	);
}

/**
 * What the BOUND backend says it can do right now.
 *
 * Deliberately says nothing about WHY it might be unavailable: the capability
 * probe defaults `available` to true when the sidecar does not answer, so
 * "asleep" and "no Python interpreter on the host" are indistinguishable from
 * here. The one hard signal for a missing interpreter is a document that
 * actually failed with `python_missing`, and that is reported on the document,
 * in its Space, where it can also be acted on.
 */
function CapabilityReadout({ capability }: { capability: ParseCapability }) {
	return (
		<ItemGroup className="overflow-hidden rounded-lg bg-background shadow-none">
			<Item className="justify-between" size="sm">
				<ItemTitle>Reported status</ItemTitle>
				<ItemActions>
					<Badge variant={capability.available ? "secondary" : "destructive"}>
						{capability.available ? "ready" : "cannot run"}
					</Badge>
				</ItemActions>
			</Item>
			<ItemSeparator />
			<Item className="justify-between" size="sm">
				<ItemTitle>Readable formats</ItemTitle>
				<ItemActions>
					<span className="text-foreground text-sm">
						{capability.extensions.length}
					</span>
				</ItemActions>
			</Item>
			{capability.missingDependencies.length > 0 ? (
				<>
					<ItemSeparator />
					<Item className="justify-between" size="sm">
						<ItemContent>
							<ItemTitle>Missing native tools</ItemTitle>
							<ItemDescription>
								Some formats will fail until these are installed on the host.
							</ItemDescription>
						</ItemContent>
						<ItemActions>
							<span className="text-foreground text-sm">
								{capability.missingDependencies.join(", ")}
							</span>
						</ItemActions>
					</Item>
				</>
			) : null}
		</ItemGroup>
	);
}

/** Node-wide upload ceilings. Read-only: they are limits Core compiles in, not
 *  preferences, and rendering them as editable would be a lie. */
function UploadLimitsCard({
	capability,
}: {
	capability: ParseCapability | null;
}) {
	return (
		<div className="space-y-3 rounded-lg bg-muted/40 p-4">
			<div>
				<p className="font-medium text-sm">Upload limits</p>
				<p className="text-muted-foreground text-xs">
					Enforced by this node. Files are stored on the node's own disk, as
					content-addressed blobs under its data directory.
				</p>
			</div>
			<ItemGroup className="overflow-hidden rounded-lg bg-background shadow-none">
				<Item className="justify-between" size="sm">
					<ItemContent>
						<ItemTitle>Maximum file in a Space</ItemTitle>
						<ItemDescription>
							Per file, uploaded straight into a Space.
						</ItemDescription>
					</ItemContent>
					<ItemActions>
						<span className="text-foreground text-sm">
							{formatBytes(SPACE_UPLOAD_MAX_BYTES)}
						</span>
					</ItemActions>
				</Item>
				{capability && capability.maxInputBytes > 0 ? (
					<>
						<ItemSeparator />
						<Item className="justify-between" size="sm">
							<ItemContent>
								<ItemTitle>Maximum chat attachment</ItemTitle>
								<ItemDescription>
									A document sent through the composer is parsed in memory, so
									its ceiling is lower than a Space file's.
								</ItemDescription>
							</ItemContent>
							<ItemActions>
								<span className="text-foreground text-sm">
									{formatBytes(capability.maxInputBytes)}
								</span>
							</ItemActions>
						</Item>
					</>
				) : null}
			</ItemGroup>
		</div>
	);
}
