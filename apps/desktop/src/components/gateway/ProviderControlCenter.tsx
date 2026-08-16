"use client";

import { CommandGroup, CommandSeparator } from "@ryu/ui/components/command";
import type { ReactNode } from "react";
import { ProviderCommandDialog } from "@/components/agent-elements/input/provider-command-dialog.tsx";
import { CapabilityProvidersSettings } from "@/src/components/settings/CapabilityProvidersSettings.tsx";
import { LlmProvidersSettings } from "@/src/components/settings/LlmProvidersSettings.tsx";

/**
 * Single entry point for node provider configuration. The capability editors
 * keep their own persistence contracts; this component owns discovery and
 * navigation so every provider surface opens from the same command dialog.
 */
export function ProviderControlCenter({
	credentials,
	integrations,
	routing,
}: {
	credentials: ReactNode;
	integrations: ReactNode;
	routing: ReactNode;
}) {
	return (
		<ProviderCommandDialog
			renderBody={() => (
				<>
					<CommandGroup heading="Chat providers and models">
						<div className="p-2">
							<LlmProvidersSettings />
						</div>
					</CommandGroup>
					<CommandSeparator />
					<CommandGroup heading="Image, speech, video, and embeddings">
						<div className="p-2">
							<CapabilityProvidersSettings />
						</div>
					</CommandGroup>
					<CommandSeparator />
					<CommandGroup heading="Credentials and integrations">
						<div className="p-2">{credentials}</div>
						<div className="p-2">{integrations}</div>
					</CommandGroup>
					<CommandSeparator />
					<CommandGroup heading="Routing and defaults">
						<div className="p-2">{routing}</div>
					</CommandGroup>
				</>
			)}
			title="Provider command center"
			trigger={
				<button
					className="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted/40"
					type="button"
				>
					Open provider command center
				</button>
			}
		/>
	);
}
