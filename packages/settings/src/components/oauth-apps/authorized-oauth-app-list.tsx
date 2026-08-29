import { Button } from "@ryu/ui/components/button";
import { formatDistanceToNow } from "date-fns";
import { AppWindow, Trash2 } from "lucide-react";
import type { OAuthApp } from "../../utils/api-client.ts";
import { scopeLabel } from "./shared.ts";

export function AuthorizedOAuthAppList({
	apps,
	confirmRevoke,
	isRevoking,
	onConfirmRevoke,
	onRevoke,
	onStartRevoke,
}: {
	apps: OAuthApp[];
	confirmRevoke: string | null;
	isRevoking: boolean;
	onConfirmRevoke: () => void;
	onRevoke: (clientId: string) => void;
	onStartRevoke: (clientId: string) => void;
}) {
	if (apps.length === 0) {
		return (
			<p className="py-4 text-center text-muted-foreground text-sm">
				No authorized apps.
			</p>
		);
	}

	return (
		<div className="space-y-2">
			{apps.map((app) => {
				const isConfirming = confirmRevoke === app.clientId;
				const scopeList = app.scopes
					.split(/[,\s]+/)
					.filter(Boolean)
					.map(scopeLabel)
					.join(", ");

				return (
					<div
						className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
						key={app.clientId}
					>
						<AppWindow className="size-4 shrink-0 text-muted-foreground" />
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium text-sm">{app.clientName}</p>
							<p className="text-muted-foreground text-xs">
								{scopeList || "No scopes"} \u00b7 Authorized{" "}
								{formatDistanceToNow(new Date(app.grantedAt), {
									addSuffix: true,
								})}
							</p>
						</div>
						{isConfirming ? (
							<div className="flex shrink-0 items-center gap-2">
								<span className="text-muted-foreground text-xs">
									Revoke access?
								</span>
								<Button
									disabled={isRevoking}
									onClick={() => onRevoke(app.clientId)}
									size="sm"
									variant="destructive"
								>
									Revoke
								</Button>
								<Button
									disabled={isRevoking}
									onClick={onConfirmRevoke}
									size="sm"
									variant="ghost"
								>
									Cancel
								</Button>
							</div>
						) : (
							<Button
								aria-label={`Revoke access for ${app.clientName}`}
								className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
								disabled={isRevoking}
								onClick={() => onStartRevoke(app.clientId)}
								size="icon"
								variant="ghost"
							>
								<Trash2 className="size-4" />
							</Button>
						)}
					</div>
				);
			})}
		</div>
	);
}
