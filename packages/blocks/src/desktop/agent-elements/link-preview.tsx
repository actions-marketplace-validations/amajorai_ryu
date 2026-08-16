"use client";

import { Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@ryu/ui/components/hover-card";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { FileTypeIcon } from "./file-type-icon.tsx";

export interface WebsiteLinkPreview {
	description?: string | null;
	image?: string | null;
	siteName?: string | null;
	title?: string | null;
	url: string;
}

export interface FileLinkPreview {
	name: string;
	path: string;
	snippet: string;
}

export interface LinkPreviewResolvers {
	previewFile?: (path: string) => Promise<FileLinkPreview | null>;
	previewWebsite?: (url: string) => Promise<WebsiteLinkPreview | null>;
}

type LinkTarget =
	| { kind: "file"; value: string }
	| { kind: "website"; value: string };

const websiteCache = new Map<string, WebsiteLinkPreview | null>();
const fileCache = new Map<string, FileLinkPreview | null>();

function WebsitePreviewCard({
	data,
	url,
}: {
	data: WebsiteLinkPreview | null | undefined;
	url: string;
}) {
	const hostname = (() => {
		try {
			return new URL(url).hostname;
		} catch {
			return url;
		}
	})();
	return (
		<div className="overflow-hidden rounded-2xl">
			{data?.image ? (
				<img
					alt=""
					className="aspect-[1.91/1] w-full bg-muted object-cover"
					src={data.image}
				/>
			) : (
				<div className="flex h-20 items-center justify-center bg-muted/60">
					<HugeiconsIcon
						className="size-6 text-muted-foreground"
						icon={Globe02Icon}
					/>
				</div>
			)}
			<div className="space-y-1 p-3">
				<p className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
					{data?.siteName || hostname}
				</p>
				<p className="line-clamp-2 font-medium text-sm leading-5">
					{data?.title || hostname}
				</p>
				{data?.description ? (
					<p className="line-clamp-3 text-muted-foreground text-xs leading-4">
						{data.description}
					</p>
				) : null}
				<p className="truncate pt-0.5 text-[10px] text-muted-foreground/70">
					{url}
				</p>
			</div>
		</div>
	);
}

function FilePreviewCard({
	data,
	path,
}: {
	data: FileLinkPreview | null | undefined;
	path: string;
}) {
	const name = data?.name ?? path.split(/[\\/]/).at(-1) ?? path;
	return (
		<div className="overflow-hidden rounded-2xl">
			<div className="flex items-center gap-2 border-border/60 border-b px-3 py-2.5">
				<FileTypeIcon className="size-5" path={path} />
				<div className="min-w-0">
					<p className="truncate font-medium text-sm">{name}</p>
					<p className="truncate text-[10px] text-muted-foreground">{path}</p>
				</div>
			</div>
			<div className="relative max-h-48 overflow-hidden bg-muted/35">
				<pre className="overflow-hidden whitespace-pre-wrap p-3 font-mono text-[10px] text-foreground/75 leading-4">
					{data?.snippet || "Preview unavailable"}
				</pre>
				<div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-popover" />
			</div>
		</div>
	);
}

/** Hover/focus preview shared by Markdown links and plaintext user-message links. */
export function LinkPreview({
	children,
	resolvers,
	target,
}: {
	children: ReactElement;
	resolvers?: LinkPreviewResolvers;
	target: LinkTarget;
}) {
	const [open, setOpen] = useState(false);
	const cache = target.kind === "file" ? fileCache : websiteCache;
	const [preview, setPreview] = useState(() => cache.get(target.value));

	useEffect(() => {
		if (!open || cache.has(target.value)) {
			return;
		}
		let cancelled = false;
		if (target.kind === "file") {
			const request = resolvers?.previewFile?.(target.value);
			request
				?.then((value) => {
					if (!cancelled) {
						fileCache.set(target.value, value);
						setPreview(value);
					}
				})
				.catch(() => {
					if (!cancelled) {
						fileCache.set(target.value, null);
						setPreview(null);
					}
				});
		} else {
			const request = resolvers?.previewWebsite?.(target.value);
			request
				?.then((value) => {
					if (!cancelled) {
						websiteCache.set(target.value, value);
						setPreview(value);
					}
				})
				.catch(() => {
					if (!cancelled) {
						websiteCache.set(target.value, null);
						setPreview(null);
					}
				});
		}
		return () => {
			cancelled = true;
		};
	}, [cache, open, resolvers, target.kind, target.value]);

	return (
		<HoverCard onOpenChange={setOpen} open={open}>
			<HoverCardTrigger closeDelay={80} delay={220} render={children} />
			<HoverCardContent
				align="start"
				className="w-80 max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl p-0"
				side="top"
				sideOffset={8}
			>
				{target.kind === "file" ? (
					<FilePreviewCard
						data={preview as FileLinkPreview | null | undefined}
						path={target.value}
					/>
				) : (
					<WebsitePreviewCard
						data={preview as WebsiteLinkPreview | null | undefined}
						url={target.value}
					/>
				)}
			</HoverCardContent>
		</HoverCard>
	);
}
