"use client";

import { Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button.tsx";
import { useGatewayDialog } from "@/src/store/useGatewayDialog.ts";

/** The picker footer action for model visibility and provider discovery settings. */
export function ManageModelsButton({ close }: { close: () => void }) {
	const openGateway = useGatewayDialog((state) => state.openGateway);

	return (
		<Button
			className="w-full justify-start gap-2"
			onClick={() => {
				close();
				openGateway("providers");
			}}
			size="sm"
			type="button"
			variant="ghost"
		>
			<HugeiconsIcon icon={Settings01Icon} size={15} strokeWidth={2} />
			Manage models
		</Button>
	);
}
