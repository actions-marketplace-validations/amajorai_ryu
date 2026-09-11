import { type ComponentProps, lazy } from "react";
import { DeferredSettingsDialog } from "../settings/DeferredSettingsDialog.tsx";

const load = () => import("./GatewayDialog.tsx");
const Content = lazy(() =>
	load().then((module) => ({ default: module.GatewayDialog }))
);
type Props = ComponentProps<typeof import("./GatewayDialog.tsx").GatewayDialog>;
export function preloadGatewayDialog(): void {
	void load().catch(() => undefined);
}
export function GatewayDialog(props: Props) {
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
