import { useStepUp as useSharedStepUp } from "@ryu/blocks/web/use-step-up.tsx";
import { stepUpClient } from "@/lib/step-up.ts";
import { useSettingsDialog } from "@/store/useSettingsDialog.ts";

/**
 * The desktop app's binding of the shared "confirm it's you" prompt.
 *
 * Differs from the website in exactly two ways, both injected: the client is
 * bearer-token authenticated (the desktop has no session cookie), and enrolling
 * a second factor opens the Account section of App Settings rather than
 * navigating to a page — the desktop's 2FA setup is a dialog, not a route.
 *
 * Usage mirrors the web:
 *
 *   const stepUp = useStepUp();
 *   // …render {stepUp.dialog} once in the component…
 *   await stepUp.guard("node.destroy", () => destroyNode(id));
 */
export function useStepUp() {
	const openSettings = useSettingsDialog((state) => state.openSettings);
	return useSharedStepUp({
		client: stepUpClient,
		onEnrol2fa: () => openSettings("account"),
	});
}
