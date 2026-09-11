import { useI18n } from "@ryu/i18n/react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { type ReactNode, Suspense, useState } from "react";

/** Defer the first mount, then retain dialog state between later openings. */
export function DeferredSettingsDialog({
	children,
	open,
	onOpenChange,
	title,
}: {
	children: ReactNode;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
}) {
	const { t } = useI18n();
	const [hasOpened, setHasOpened] = useState(open);
	if (open && !hasOpened) {
		setHasOpened(true);
	}
	if (!(open || hasOpened)) {
		return null;
	}
	return (
		<Suspense
			fallback={
				<Dialog onOpenChange={onOpenChange} open={open}>
					<DialogContent className="!w-[85vw] !max-w-7xl max-md:!w-screen max-md:!max-w-none h-[85vh] max-md:h-[100dvh] max-md:rounded-none">
						<DialogHeader className="sr-only">
							<DialogTitle>{t("settings.title", {}, title)}</DialogTitle>
							<DialogDescription>
								{t("settings.loading", {}, "Opening settings")}
							</DialogDescription>
						</DialogHeader>
						<div className="grid size-full place-items-center">
							<Spinner />
						</div>
					</DialogContent>
				</Dialog>
			}
		>
			{children}
		</Suspense>
	);
}
