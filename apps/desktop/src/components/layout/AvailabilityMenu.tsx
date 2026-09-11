import {
	AGENT_AVAILABILITY_OPTIONS,
	AgentAvailabilityDot,
	agentAvailabilityLabel,
} from "@ryu/blocks/desktop/agent-availability";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@ryu/ui/components/dropdown-menu";
import { Check, Settings } from "lucide-react";
import { useUserAvailability } from "@/src/hooks/useUserAvailability.ts";
import { useSettingsDialog } from "@/src/store/useSettingsDialog.ts";

type AvailabilityView = ReturnType<typeof useUserAvailability>;

function AvailabilityOptions({
	availability,
}: {
	availability: AvailabilityView;
}) {
	const openSettings = useSettingsDialog((state) => state.openSettings);

	return (
		<>
			<DropdownMenuGroup>
				{AGENT_AVAILABILITY_OPTIONS.map((option) => (
					<DropdownMenuItem
						key={option.value}
						onClick={() => availability.setStatus(option.value)}
					>
						<AgentAvailabilityDot className="mr-2" status={option.value} />
						<span className="flex-1">{option.label}</span>
						{availability.status === option.value ? (
							<Check className="size-4 text-muted-foreground" />
						) : null}
					</DropdownMenuItem>
				))}
			</DropdownMenuGroup>
			<DropdownMenuSeparator />
			<DropdownMenuItem onClick={() => openSettings("general")}>
				<Settings className="mr-2 size-4" />
				Availability settings
			</DropdownMenuItem>
		</>
	);
}

/** Direct user-nav control for the status that governs human-input prompts. */
export function AvailabilityStatusButton() {
	const availability = useUserAvailability();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<button
						aria-label={`Availability: ${agentAvailabilityLabel(availability.status)}`}
						className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						type="button"
					/>
				}
			>
				<AgentAvailabilityDot status={availability.status} />
				<span>{agentAvailabilityLabel(availability.status)}</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="min-w-60" side="top">
				<div className="px-3 py-2">
					<p className="font-medium text-sm">Prompt interruptions</p>
					<p className="mt-0.5 text-muted-foreground text-xs">
						{availability.status === "away" && availability.source === "afk"
							? "Away from AFK detection"
							: "Choose when Ryu may ask for a decision"}
					</p>
				</div>
				<DropdownMenuSeparator />
				<AvailabilityOptions availability={availability} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
