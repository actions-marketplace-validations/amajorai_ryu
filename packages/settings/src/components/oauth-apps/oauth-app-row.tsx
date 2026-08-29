import { Badge } from "@ryu/ui/components/badge";
import { Button } from "@ryu/ui/components/button";
import { formatDistanceToNow } from "date-fns";
import { KeyRound, RefreshCw, Trash2 } from "lucide-react";
import type { OwnedOAuthApp } from "../../utils/api-client.ts";
import { type PendingAction, scopeLabel } from "./shared.ts";

export function OAuthAppRow({
	app,
	pendingAction,
	onAction,
	onCancelAction,
}: {
	app: OwnedOAuthApp;
	pendingAction: PendingAction;
	onAction: (action: PendingAction) => void;
	onCancelAction: () => void;
}) {
	const isDeleting =
		pendingAction?.kind === "delete" && pendingAction.clientId === app.clientId;
	const isRotating =
		pendingAction?.kind === "rotate" && pendingAction.clientId === app.clientId;
	const isPending = isDeleting || isRotating;

	return (
		<div className="space-y-3 rounded-lg border p-3">
			<div className="flex flex-wrap items-start gap-3">
				<KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<p className="font-medium text-sm">{app.clientName}</p>
						<Badge variant="secondary">
							{app.clientType === "public" ? "Public" : "Confidential"}
						</Badge>
						<Badge variant="outline">{app.applicationType}</Badge>
					</div>
					<p className="mt-1 break-all font-mono text-muted-foreground text-xs">
						{app.clientId}
					</p>
					<p className="mt-1 text-muted-foreground text-xs">
						Created{" "}
						{app.createdAt
							? formatDistanceToNow(new Date(app.createdAt), {
									addSuffix: true,
								})
							: "recently"}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{app.clientType === "confidential" ? (
						<Button
							aria-label={`Rotate secret for ${app.clientName}`}
							disabled={isPending}
							onClick={() =>
								onAction({ clientId: app.clientId, kind: "rotate" })
							}
							size="icon"
							variant="ghost"
						>
							<RefreshCw className="size-4" />
						</Button>
					) : null}
					<Button
						aria-label={`Delete ${app.clientName}`}
						disabled={isPending}
						onClick={() => onAction({ clientId: app.clientId, kind: "delete" })}
						size="icon"
						variant="ghost"
					>
						<Trash2 className="size-4 text-destructive" />
					</Button>
				</div>
			</div>

			<div className="space-y-1 text-muted-foreground text-xs">
				<p>
					<strong className="font-medium text-foreground">
						Redirect URIs:
					</strong>{" "}
					{app.redirectUris.join(", ")}
				</p>
				<p>
					<strong className="font-medium text-foreground">
						Allowed scopes:
					</strong>{" "}
					{app.scopes.map(scopeLabel).join(", ") || "None"}
				</p>
			</div>

			{isPending ? (
				<div className="flex flex-wrap items-center gap-2 border-t pt-3">
					<span className="text-muted-foreground text-xs">
						{isDeleting
							? "Delete this OAuth app and revoke its tokens?"
							: "Rotate the secret now? The old secret stops working immediately."}
					</span>
					<Button
						onClick={() => onAction(pendingAction)}
						size="sm"
						variant={isDeleting ? "destructive" : "default"}
					>
						{isDeleting ? "Delete" : "Rotate"}
					</Button>
					<Button onClick={onCancelAction} size="sm" variant="ghost">
						Cancel
					</Button>
				</div>
			) : null}
		</div>
	);
}
