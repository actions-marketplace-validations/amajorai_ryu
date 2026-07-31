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
import { formatBytes, NODE_UPLOAD_MAX_BYTES } from "@/src/lib/api/spaces.ts";

/**
 * NODE-scoped settings for `document.parse`: which app extracts text from
 * uploaded documents, and the node's upload ceilings.
 *
 * Node-scoped is not a filing decision. One provider is bound per node and it
 * serves every Space and every chat attachment on it, so putting this in the
 * per-user App Settings dialog would imply a per-user choice that does not
 * exist. It belongs in the Gateway dialog, beside `StorageSettings` and
 * `PrivacySettings`.
 *
 * Mounted as the Gateway dialog's **Document parsing** section
 * (`GatewayDialog.tsx`, `GatewaySection = "parsing"`, in the "This computer"
 * group beside Storage). It shipped unmounted for one round — nothing imported
 * it, so the parser could not be bound and neither ceiling was visible anywhere.
 *
 * The extractor is a CAPABILITY, not a Rust trait — several apps can provide it
 * and Core resolves one with `user override > sole provider > declared default >
 * lowest id`. This panel owns exactly the first rung.
 *
 * ## Two reads, and why neither may stand in for the other
 *
 * - `fetchParseBackends` → `GET /api/capabilities`, filtered to `document.parse`.
 *   WHO could parse and who is bound. Pure registry data; always answers.
 * - `fetchParseCapability` → `GET /api/documents/parse/capability`. What the bound
 *   backend can actually DO on this machine right now — its format list, the
 *   native tools it cannot find, and the byte ceiling the node enforces. It probes
 *   the sidecar with a 2s budget and never wakes a sleeping one, so it is allowed
 *   to come back thin without taking the picker down with it.
 *
 * Every byte figure and every format claim below comes from the second read. The
 * panel holds no upload constant of its own beyond a labelled fallback for when
 * that read fails: a client-side number cannot know which backend is bound, and
 * printing one as if the node had said it is how this panel previously promised a
 * 200 MiB ceiling the node refused at 32 MiB.
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
	// The floor comes from the CAPABILITY read, not the registry one: it is a fact
	// about the Core build (`BUILTIN_EXTENSIONS`), not about which apps are
	// installed, and `/api/capabilities` has no business reporting it.
	const builtin = capability?.builtinExtensions ?? [];

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

			{/* Rendered whenever the node ANSWERED, not only when a provider is
			    bound. Gating it on `capability.provider` hid the readout on exactly
			    the node that most needs it — the one with every parser disabled,
			    where "readable formats: 8" is the difference between "this machine
			    reads nothing" and "this machine reads the text floor". */}
			{capability ? <CapabilityReadout capability={capability} /> : null}

			<p className="text-muted-foreground text-xs">
				Changing the parser does not re-read files that are already stored. Open
				a Space and use <strong>Re-parse all</strong> to apply the new backend
				to what is already there.
			</p>
		</div>
	);
}

/**
 * What the bound backend says it can do right now — `GET /api/documents/parse/capability`.
 *
 * Deliberately says nothing about WHY it might be unavailable: the capability
 * probe defaults `available` to true when the sidecar does not answer, so
 * "asleep" and "no Python interpreter on the host" are indistinguishable from
 * here. The one hard signal for a missing interpreter is a document that
 * actually failed with `python_missing`, and that is reported on the document,
 * in its Space, where it can also be acted on.
 *
 * The "Parser" row is the node's own name for what is bound, which is not the same
 * claim as the `Bound` badge above it: the badge comes from the capability
 * REGISTRY (who Core would resolve), this comes from the parse facade (who it
 * actually resolved when asked). They agree in every normal state, and when they
 * disagree that is the thing worth seeing.
 */
function CapabilityReadout({ capability }: { capability: ParseCapability }) {
	return (
		<ItemGroup className="overflow-hidden rounded-lg bg-background shadow-none">
			<Item className="justify-between" size="sm">
				<ItemTitle>Parser</ItemTitle>
				<ItemActions>
					<span className="text-foreground text-sm">
						{capability.providerName ??
							capability.provider ??
							"built-in text only"}
					</span>
				</ItemActions>
			</Item>
			<ItemSeparator />
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

/**
 * Node-wide upload ceilings. Read-only: they are limits Core compiles in, not
 * preferences, and rendering them as editable would be a lie.
 *
 * ## The number this card must not print
 *
 * It used to print `MAX_FILE_BYTES` (200 MiB) as "Maximum file in a Space", and that
 * was a promise the node would not keep twice over:
 *
 * 1. It names `POST /api/spaces/:id/files`, a route **no surface in this app calls**.
 *    Every upload a user can perform — chat attachment, editor paste, `ui.uploadFile`
 *    — goes to `POST /api/uploads` and stops at {@link NODE_UPLOAD_MAX_BYTES}, 32 MiB.
 *    So a 100 MB PDF was refused by a node that had just said 200 MiB was fine.
 * 2. That route could not honour 200 MiB anyway: it was registered with no
 *    `DefaultBodyLimit`, so axum's implicit 2 MiB body limit rejected the request
 *    before the handler's own check ran — and its body is base64, so the true
 *    ceiling was ~1.5 MiB of file.
 *
 * Printing both ceilings was the other option and it is worse: the second number was
 * wrong, so "print both with what each governs" would have meant printing one honest
 * limit beside one that is off by a factor of 100.
 *
 * Core has since converged the two (`MAX_FILE_BYTES = uploads::MAX_UPLOAD_BYTES`, and
 * `/api/spaces/:id/files` now layers `SPACE_FILE_BODY_LIMIT`), so every route a user
 * can reach stops at the same number. That is a reason this card is no longer WRONG,
 * not a reason to hardcode the number: it converged once and could diverge again,
 * and a panel that reads the node cannot be wrong the next time it moves. See
 * `SPACE_UPLOAD_MAX_BYTES` in `lib/api/spaces.ts`, whose own mirror tests track that
 * Rust side.
 *
 * ## Why there is one row and not two
 *
 * The parse ceiling used to be a second row, shown only when it DIFFERED from the
 * upload ceiling. Core defines `MAX_PARSE_BYTES = MAX_UPLOAD_BYTES`, so it never
 * differed and the row never rendered — a permanently dead branch whose only visible
 * effect was that the surviving row printed a client-side constant.
 *
 * Restoring it as an always-on twin would be worse than dead: `POST /api/documents/parse`,
 * the route that enforces the parse ceiling, is **not registered** (see
 * `document_parse.rs`), and the in-process path that Space and chat uploads actually
 * take is bounded by `MAX_BLOB_PARSE_BYTES` (200 MiB) — above the upload ceiling, so
 * never the binding constraint. A "maximum document this parser will read" row would
 * therefore describe an enforcement point no user can reach, which is the same class
 * of claim as the 200 MiB figure this card was built to delete.
 *
 * So: one row, one enforcement point, and its value comes from the node
 * (`max_input_bytes`) rather than from a constant compiled into this app.
 */
function UploadLimitsCard({
	capability,
}: {
	capability: ParseCapability | null;
}) {
	// Node-reported first. The constant is the fallback for a failed/timed-out
	// capability read ONLY, and the row says so when it is used — a number this app
	// compiled in cannot know what the node it is pointed at enforces, and the last
	// time this panel printed one unlabelled it was wrong by a factor of 6.
	const reported = capability?.maxInputBytes ?? 0;
	const limit = reported > 0 ? reported : NODE_UPLOAD_MAX_BYTES;

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
						<ItemTitle>Maximum file you can upload</ItemTitle>
						<ItemDescription>
							{reported > 0
								? "Reported by this node. Chat attachments, files added to a Space and images pasted into a page all go through the same upload route, and the parser accepts the same size, so one number governs all of them."
								: "This node did not report its limit, so this is the desktop's built-in default — the real ceiling may differ. Use Refresh once the node is reachable."}
						</ItemDescription>
					</ItemContent>
					<ItemActions>
						<span className="text-foreground text-sm">
							{formatBytes(limit)}
						</span>
					</ItemActions>
				</Item>
			</ItemGroup>
		</div>
	);
}
