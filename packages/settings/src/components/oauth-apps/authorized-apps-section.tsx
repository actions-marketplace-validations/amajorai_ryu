import { Separator } from "@ryu/ui/components/separator";
import { Spinner } from "@ryu/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { sileo } from "sileo";
import { settingsApi } from "../../utils/api-client.ts";
import { AuthorizedOAuthAppList } from "./authorized-oauth-app-list.tsx";
import { errorMessage } from "./shared.ts";

export function AuthorizedAppsSection() {
	const queryClient = useQueryClient();
	const authorizedQuery = useQuery({
		queryKey: ["oauth-apps", "authorized"],
		queryFn: settingsApi.oauthApps.list,
		staleTime: 5 * 60 * 1000,
	});
	const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
	const revokeMutation = useMutation({
		mutationFn: settingsApi.oauthApps.revoke,
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["oauth-apps", "authorized"],
			});
			setConfirmRevoke(null);
			sileo.success({ title: "OAuth access revoked" });
		},
		onError: () => sileo.error({ title: "Failed to revoke OAuth access" }),
	});

	const authorizedApps = authorizedQuery.data?.apps ?? [];
	const ryuApps = authorizedApps.filter((app) => app.kind === "ryu");
	const thirdPartyApps = authorizedApps.filter((app) => app.kind === "oauth");

	return (
		<>
			<AuthorizedAppsListSection
				apps={ryuApps}
				confirmRevoke={confirmRevoke}
				description="First-party Ryu clients that have access to this account."
				error={authorizedQuery.error}
				isLoading={authorizedQuery.isLoading}
				isRevoking={revokeMutation.isPending}
				onConfirmRevoke={() => setConfirmRevoke(null)}
				onRevoke={(clientId) => revokeMutation.mutate(clientId)}
				onStartRevoke={setConfirmRevoke}
				title="Authorized Ryu Apps"
			/>
			<AuthorizedAppsListSection
				apps={thirdPartyApps}
				confirmRevoke={confirmRevoke}
				description="Third-party apps that have received your consent. Revoking access also invalidates their Ryu authorization."
				error={authorizedQuery.error}
				isLoading={authorizedQuery.isLoading}
				isRevoking={revokeMutation.isPending}
				onConfirmRevoke={() => setConfirmRevoke(null)}
				onRevoke={(clientId) => revokeMutation.mutate(clientId)}
				onStartRevoke={setConfirmRevoke}
				title="Authorized OAuth Apps"
			/>
		</>
	);
}

function AuthorizedAppsListSection({
	apps,
	confirmRevoke,
	description,
	error,
	isLoading,
	isRevoking,
	onConfirmRevoke,
	onRevoke,
	onStartRevoke,
	title,
}: {
	apps: Parameters<typeof AuthorizedOAuthAppList>[0]["apps"];
	confirmRevoke: string | null;
	description: string;
	error: unknown;
	isLoading: boolean;
	isRevoking: boolean;
	onConfirmRevoke: () => void;
	onRevoke: (clientId: string) => void;
	onStartRevoke: (clientId: string) => void;
	title: string;
}) {
	return (
		<section className="space-y-4">
			<div>
				<h3 className="font-medium text-sm">{title}</h3>
				<p className="mt-0.5 text-muted-foreground text-xs">{description}</p>
			</div>
			<Separator />
			{isLoading ? (
				<div className="flex justify-center py-4">
					<Spinner className="size-5" />
				</div>
			) : error ? (
				<p className="text-destructive text-sm">
					{errorMessage(error, "Failed to load authorized apps")}
				</p>
			) : (
				<AuthorizedOAuthAppList
					apps={apps}
					confirmRevoke={confirmRevoke}
					isRevoking={isRevoking}
					onConfirmRevoke={onConfirmRevoke}
					onRevoke={onRevoke}
					onStartRevoke={onStartRevoke}
				/>
			)}
		</section>
	);
}
