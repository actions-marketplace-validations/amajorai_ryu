// apps/desktop/src/pages/ArtifactViewPage.tsx
//
// The WORKSPACE-tab half of an artifact: `/artifact/<id>` renders the artifact
// the agent surfaced (created via `artifact.create` or rendered inline via
// `artifact.render`) full-size, using the same `ArtifactRenderer` the right
// dock's artifact tab uses. Artifacts are session-local (see
// `useArtifactStore`), so a restored tab whose id is gone shows the same
// "no longer available" the dock tab does.

import { ArtifactRenderer } from "@/src/components/chat/ArtifactRenderer.tsx";
import { useArtifactStore } from "@/src/store/useArtifactStore.ts";

export default function ArtifactViewPage({
	artifactId,
}: {
	artifactId: string;
}) {
	const artifact = useArtifactStore((s) => s.artifacts[artifactId]);

	if (!artifact) {
		return (
			<div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground text-xs">
				This artifact is no longer available.
			</div>
		);
	}

	return <ArtifactRenderer artifact={artifact} />;
}
