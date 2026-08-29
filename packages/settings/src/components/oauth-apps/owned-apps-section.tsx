import { Button } from "@ryu/ui/components/button";
import { Separator } from "@ryu/ui/components/separator";
import { Spinner } from "@ryu/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { sileo } from "sileo";
import { type OwnedOAuthApp, settingsApi } from "../../utils/api-client.ts";
import { OAuthAppRegistrationDialog } from "./oauth-app-registration-dialog.tsx";
import { OAuthAppRow } from "./oauth-app-row.tsx";
import { errorMessage, type PendingAction } from "./shared.ts";

export function OwnedAppsSection() {
	const queryClient = useQueryClient();
	const ownedQuery = useQuery({
		queryKey: ["oauth-apps", "owned"],
		queryFn: settingsApi.oauthApps.owned.list,
		staleTime: 5 * 60 * 1000,
	});
	const [pendingAction, setPendingAction] = useState<PendingAction>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [createdApp, setCreatedApp] = useState<OwnedOAuthApp | null>(null);
	const deleteMutation = useMutation({
		mutationFn: settingsApi.oauthApps.owned.delete,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["oauth-apps", "owned"] });
			setPendingAction(null);
			sileo.success({ title: "OAuth app deleted" });
		},
		onError: () => sileo.error({ title: "Failed to delete OAuth app" }),
	});
	const rotateMutation = useMutation({
		mutationFn: settingsApi.oauthApps.owned.rotateSecret,
		onSuccess: ({ app }) => {
			setCreatedApp(app);
			setDialogOpen(true);
			setPendingAction(null);
			void queryClient.invalidateQueries({ queryKey: ["oauth-apps", "owned"] });
		},
		onError: () => sileo.error({ title: "Failed to rotate OAuth app secret" }),
	});

	function handleAction(action: PendingAction) {
		if (!action) {
			return;
		}
		if (
			action.kind === "delete" &&
			pendingAction?.kind === "delete" &&
			pendingAction.clientId === action.clientId
		) {
			deleteMutation.mutate(action.clientId);
			return;
		}
		if (
			action.kind === "rotate" &&
			pendingAction?.kind === "rotate" &&
			pendingAction.clientId === action.clientId
		) {
			rotateMutation.mutate(action.clientId);
			return;
		}
		setPendingAction(action);
	}

	function openCreate() {
		setCreatedApp(null);
		setDialogOpen(true);
	}

	const ownedApps = ownedQuery.data?.apps ?? [];
	const pending = deleteMutation.isPending || rotateMutation.isPending;

	return (
		<section className="space-y-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 className="font-medium text-sm">Your OAuth apps</h3>
					<p className="mt-0.5 max-w-2xl text-muted-foreground text-xs">
						Register an app that can ask Ryu users for scoped access. Client
						secrets are shown once when created or rotated.
					</p>
				</div>
				<Button onClick={openCreate} size="sm">
					Create OAuth app
				</Button>
			</div>
			<Separator />
			{ownedQuery.isLoading ? (
				<div className="flex justify-center py-4">
					<Spinner className="size-5" />
				</div>
			) : ownedQuery.isError ? (
				<p className="text-destructive text-sm">
					{errorMessage(ownedQuery.error, "Failed to load your OAuth apps")}
				</p>
			) : ownedApps.length === 0 ? (
				<p className="py-4 text-center text-muted-foreground text-sm">
					You have not registered an OAuth app yet.
				</p>
			) : (
				<div className="space-y-3">
					{ownedApps.map((app) => (
						<OAuthAppRow
							app={app}
							key={app.clientId}
							onAction={handleAction}
							onCancelAction={() => setPendingAction(null)}
							pendingAction={pendingAction}
						/>
					))}
				</div>
			)}
			<OAuthAppRegistrationDialog
				createdApp={createdApp}
				onCreated={() => {
					void queryClient.invalidateQueries({
						queryKey: ["oauth-apps", "owned"],
					});
				}}
				onCreatedAppChange={setCreatedApp}
				onOpenChange={setDialogOpen}
				open={dialogOpen}
			/>
			{pending ? <span className="sr-only">Updating OAuth app</span> : null}
		</section>
	);
}
