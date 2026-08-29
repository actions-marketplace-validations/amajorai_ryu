import { Add01Icon, Folder03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button.tsx";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { NodeFolderBrowser } from "@/src/components/chat/NodeFolderBrowser.tsx";
import { ProjectSettingsDialog } from "@/src/components/layout/ProjectSettingsDialog.tsx";
import { SettingsSection } from "@/src/components/settings/shared/settings-items.tsx";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { fetchGatewayGovernance } from "@/src/lib/api/governance.ts";
import { basename } from "@/src/lib/files.ts";
import { useWorkspaceStore } from "@/src/store/useWorkspaceStore.ts";
import {
	GovernanceScopeSwitcher,
	type GovernanceView,
} from "./GovernanceScopeSwitcher.tsx";

const queryKey = (url: string, token: string | null) => [
	"gateway-governance",
	url,
	token,
];

export function EnvironmentsSection() {
	const node = useActiveNode();
	const [browserOpen, setBrowserOpen] = useState(false);
	const [editingPath, setEditingPath] = useState<string | null>(null);
	const [scope, setScope] = useState<GovernanceView>("effective");
	const projects = useWorkspaceStore((state) => state.projects);
	const recentFolders = useWorkspaceStore((state) => state.recentFolders);
	const addProjectFolder = useWorkspaceStore((state) => state.addProjectFolder);
	const paths = useMemo(() => {
		const allPaths = new Set<string>();
		for (const project of projects) {
			for (const folder of project.folders) {
				allPaths.add(folder);
			}
		}
		for (const folder of recentFolders) {
			allPaths.add(folder);
		}
		return [...allPaths].sort((left, right) => left.localeCompare(right));
	}, [projects, recentFolders]);
	const governance = useQuery({
		queryKey: queryKey(node.url, node.token ?? null),
		queryFn: ({ signal }) =>
			fetchGatewayGovernance(
				{ url: node.url, token: node.token, userJwt: node.userJwt ?? null },
				signal
			),
	});

	return (
		<>
			<div className="space-y-6">
				<SettingsSection
					caption="Local environments tell Ryu how to set up worktrees for a project. Scripts and variables stay with the project on this node."
					title="Environments"
				>
					<div className="space-y-4 px-3">
						<GovernanceScopeSwitcher
							layers={governance.data?.layers ?? []}
							onValueChange={setScope}
							value={scope}
						/>
						<div className="flex items-center justify-between">
							<h3 className="font-medium text-sm">Select a project</h3>
							<Button
								onClick={() => setBrowserOpen(true)}
								size="sm"
								variant="ghost"
							>
								<HugeiconsIcon className="size-4" icon={Add01Icon} />
								Add project
							</Button>
						</div>
						{paths.length === 0 ? (
							<div className="rounded-2xl border border-dashed px-6 py-10 text-center text-muted-foreground text-sm">
								No projects yet
							</div>
						) : (
							<div className="overflow-hidden rounded-2xl border border-border/80 bg-card/45">
								{paths.map((path) => (
									<button
										className="flex w-full items-center gap-3 border-border/65 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										key={path}
										onClick={() => setEditingPath(path)}
										type="button"
									>
										<HugeiconsIcon
											className="size-4 shrink-0 text-muted-foreground"
											icon={Folder03Icon}
										/>
										<span className="min-w-0 flex-1">
											<span className="block font-medium text-sm">
												{basename(path)}
											</span>
											<span className="mt-0.5 block truncate font-mono text-muted-foreground text-xs">
												{path}
											</span>
										</span>
										<span className="text-muted-foreground text-xs">Edit</span>
									</button>
								))}
							</div>
						)}
					</div>
				</SettingsSection>
			</div>
			<NodeFolderBrowser
				onOpenChange={setBrowserOpen}
				onSelect={(path) => {
					addProjectFolder(path);
					setEditingPath(path);
					setBrowserOpen(false);
				}}
				open={browserOpen}
			/>
			{editingPath ? (
				<ProjectSettingsDialog
					onOpenChange={(open) => {
						if (!open) {
							setEditingPath(null);
						}
					}}
					open
					path={editingPath}
				/>
			) : null}
		</>
	);
}
