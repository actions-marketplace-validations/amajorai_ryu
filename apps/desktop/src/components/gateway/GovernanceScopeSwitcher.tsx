import {
	Tabs,
	TabsIndicator,
	TabsList,
	TabsTrigger,
} from "@ryu/ui/components/tabs.tsx";
import type {
	GatewayGovernanceLayer,
	GovernanceScope,
} from "@/src/lib/api/governance.ts";

export type GovernanceView = "effective" | GovernanceScope;

const VIEWS: ReadonlyArray<{ label: string; value: GovernanceView }> = [
	{ label: "Effective", value: "effective" },
	{ label: "User", value: "user" },
	{ label: "Team", value: "team" },
	{ label: "Organization", value: "organization" },
	{ label: "Node", value: "node" },
];

const isGovernanceView = (value: unknown): value is GovernanceView => {
	switch (value) {
		case "effective":
		case "user":
		case "team":
		case "organization":
		case "node":
			return true;
		default:
			return false;
	}
};

export function GovernanceScopeSwitcher({
	layers,
	onValueChange,
	value,
}: {
	layers: readonly GatewayGovernanceLayer[];
	onValueChange: (value: GovernanceView) => void;
	value: GovernanceView;
}) {
	return (
		<div className="space-y-2">
			<Tabs
				onValueChange={(next) => {
					if (isGovernanceView(next)) {
						onValueChange(next);
					}
				}}
				value={value}
			>
				<TabsList
					aria-label="Configuration scope"
					manageLayout={false}
					variant="muted-pills"
				>
					<TabsIndicator />
					{VIEWS.map((view) => {
						const layer = layers.find((item) => item.scope === view.value);
						const unavailable =
							view.value === "effective"
								? undefined
								: (layer?.unavailableReason ??
									(layer ? undefined : "This scope is unavailable."));
						return (
							<TabsTrigger
								disabled={Boolean(unavailable)}
								key={view.value}
								title={unavailable}
								value={view.value}
							>
								{view.label}
							</TabsTrigger>
						);
					})}
				</TabsList>
			</Tabs>
			{value === "effective" ? (
				<p className="text-muted-foreground text-xs">
					Resolved from user, team, organization, then node defaults.
				</p>
			) : (
				<p className="text-muted-foreground text-xs">
					{layers.find((layer) => layer.scope === value)?.writable
						? "Changes at this level override broader defaults."
						: "This level is inherited here and can only be changed by an authorized administrator."}
				</p>
			)}
		</div>
	);
}
