import { GitGraphPanel } from "@/src/components/git/GitGraphPanel.tsx";

export default function ProjectGitGraphPage({ folder }: { folder: string }) {
	return (
		<div className="h-full min-h-0">
			<GitGraphPanel folder={folder} />
		</div>
	);
}
