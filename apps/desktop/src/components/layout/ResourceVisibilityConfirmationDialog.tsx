import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@ryu/ui/components/alert-dialog.tsx";
import type { VisibilityChangeRequest } from "@/src/lib/resource-visibility.ts";

export function ResourceVisibilityConfirmationDialog({
	canMakePrivate,
	changing = false,
	onConfirm,
	onOpenChange,
	request,
}: {
	canMakePrivate: boolean;
	changing?: boolean;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	request: VisibilityChangeRequest | null;
}) {
	const sharing = request?.to === "team";
	const resourceLabel = request?.resourceType === "space" ? "Space" : "chat";
	const resourceName = request?.name ?? "this resource";
	return (
		<AlertDialog
			onOpenChange={(open) => {
				if (!changing) {
					onOpenChange(open);
				}
			}}
			open={request !== null}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{sharing ? "Share with your team?" : "Make this private?"}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{sharing
							? `"${resourceName}" will become visible to everyone in your team. Team members will be able to find and use this ${resourceLabel}.`
							: `"${resourceName}" will no longer be accessible to the team. It will remain available to you, but only organization admins can make a shared ${resourceLabel} private.`}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={changing}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						disabled={changing || !(sharing || canMakePrivate)}
						onClick={(event) => {
							if (changing || !(sharing || canMakePrivate)) {
								event.preventDefault();
								return;
							}
							event.preventDefault();
							onConfirm();
						}}
					>
						{changing
							? "Saving…"
							: sharing
								? "Share with team"
								: canMakePrivate
									? "Make private"
									: "Admins only"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
