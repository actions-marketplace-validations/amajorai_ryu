"use client";

import { Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DropdownMenuItem } from "@ryu/ui/components/dropdown-menu.tsx";
import { useGatewayDialog } from "@/src/store/useGatewayDialog.ts";

/** The picker footer action for model visibility and provider discovery settings. */
export function ManageModelsButton({ close }: { close: () => void }) {
	const openGateway = useGatewayDialog((state) => state.openGateway);

	return (
		<DropdownMenuItem
			className="gap-2"
			onClick={() => {
				close();
				openGateway("providers");
			}}
		>
			<HugeiconsIcon icon={Settings01Icon} size={16} strokeWidth={2} />
			<span className="flex-1 truncate">Manage models</span>
		</DropdownMenuItem>
	);
}
