import { type ComponentProps, lazy } from "react";
import { DeferredSettingsDialog } from "./DeferredSettingsDialog.tsx";

const load = () => import("./SettingsDialog.tsx");
const Content = lazy(() =>
	load().then((module) => ({ default: module.SettingsDialog }))
);
type Props = ComponentProps<
	typeof import("./SettingsDialog.tsx").SettingsDialog
>;
export function preloadSettingsDialog(): void {
	void load().catch(() => undefined);
}
export function SettingsDialog(props: Props) {
	return (
		<DeferredSettingsDialog
			onOpenChange={props.onOpenChange}
			open={props.open}
			title="Settings"
		>
			<Content {...props} />
		</DeferredSettingsDialog>
	);
}
