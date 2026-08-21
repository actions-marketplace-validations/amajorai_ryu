// apps/desktop/src/components/chat/InlineArtifact.tsx
//
// The desktop's injected Renderer for the blocks artifact host: a compact
// artifact card that the agent's `artifact.render` / `artifact.create` tool
// renders INLINE in the chat. Shows a live preview (same ArtifactContentView as
// the dock tab) and two affordances — "Open" (right dock artifact tab) and
// "Open in tab" (a workspace window tab) — so a user can keep one artifact on
// screen while the conversation moves on. No limit on how many render at once:
// each one is an independent card, and each Open call mints its own dock tab.
//
// A created artifact (`url` set, no inline content) is lazily fetched through
// the host's node target; until it resolves the preview shows a placeholder.

import {
	type HostArtifact,
	useArtifactHost,
} from "@ryu/blocks/desktop/agent-elements/artifact-host-context.tsx";
import { Button } from "@ryu/ui/components/button";
import {
	ButtonGroup,
	ButtonGroupSeparator,
} from "@ryu/ui/components/button-group";
import { useEffect, useMemo, useState } from "react";
import {
	ArtifactContentView,
	ArtifactHeader,
} from "@/src/components/chat/ArtifactRenderer.tsx";
import { artifactFromPayload } from "@/src/lib/artifacts.ts";

export function InlineArtifact({
	artifact: payload,
	id,
}: {
	artifact: HostArtifact;
	id: string;
}) {
	const host = useArtifactHost();
	const [fetchedContent, setFetchedContent] = useState<string | null>(null);
	const [fetching, setFetching] = useState(false);

	// A created artifact carries a blob URL but no inline content: fetch it once
	// through the host so the preview renders rather than sitting empty.
	useEffect(() => {
		if (!payload.url || payload.content) {
			setFetchedContent(null);
			return;
		}
		let cancelled = false;
		setFetching(true);
		host?.fetchContent(payload, id).then((content) => {
			if (!cancelled) {
				setFetchedContent(content);
				setFetching(false);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [host, id, payload.url, payload.content]);

	const artifact = useMemo(
		() =>
			artifactFromPayload(
				{ ...payload, content: payload.content ?? fetchedContent ?? "" },
				id,
				"tool"
			),
		[id, payload, fetchedContent]
	);

	return (
		<div className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm">
			<ArtifactHeader artifact={artifact} compact />
			<div className="h-40 min-h-0 overflow-hidden border-border/60 border-t">
				{fetching && !fetchedContent ? (
					<div className="flex h-full animate-pulse items-center justify-center bg-sidebar text-muted-foreground text-xs">
						Loading artifact…
					</div>
				) : (
					<ArtifactContentView artifact={artifact} />
				)}
			</div>
			<div className="flex shrink-0 items-center justify-end border-border/60 border-t bg-sidebar/50 px-3 py-1.5">
				<ButtonGroup aria-label="Artifact actions">
					<Button
						onClick={() => host?.openInPanel(payload, id)}
						size="sm"
						variant="ghost"
					>
						Open
					</Button>
					<ButtonGroupSeparator />
					<Button
						onClick={() => host?.openInTab(payload, id)}
						size="sm"
						variant="ghost"
					>
						Open in tab
					</Button>
				</ButtonGroup>
			</div>
		</div>
	);
}
