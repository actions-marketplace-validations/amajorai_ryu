import { PatchDiffPanel } from "@/src/components/panels/WorkspacePanels.tsx";

export default function ProjectDiffPage({ folder }: { folder: string }) {
	return (
		<div className="h-full min-h-0">
			<PatchDiffPanel folder={folder} />
		</div>
	);
}
