import { PlanBadge, type PlanTier } from "@ryu/ui/components/plan-badge.tsx";
import { Building2 } from "lucide-react";
import { useOrgBillingStatus } from "@/src/hooks/useOrgBillingStatus.ts";

export interface OrgBillingContextViewProps {
	compact?: boolean;
	description?: string;
	label?: string;
	organizationName: string | null;
	plan: PlanTier | null;
}

/** Presentational form used by the live app and the end-to-end proof artifact. */
export function OrgBillingContextView({
	compact = false,
	description = "Managed inference uses this organization’s shared credit wallet.",
	label = "Billing organization",
	organizationName,
	plan,
}: OrgBillingContextViewProps) {
	return (
		<div
			className={
				compact
					? "flex items-center gap-2 rounded-lg bg-muted/35 px-3 py-2"
					: "flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
			}
			data-testid="org-billing-context"
		>
			<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
				<Building2 className="size-4" />
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-muted-foreground text-xs">{label}</p>
				<p className="truncate font-medium text-sm">
					{organizationName ?? "No organization selected"}
				</p>
				{description ? (
					<p className="mt-0.5 text-muted-foreground text-xs">{description}</p>
				) : null}
			</div>
			<PlanBadge
				className="shrink-0"
				plan={plan}
				size={compact ? "sm" : "md"}
			/>
		</div>
	);
}

/** Live org-scoped context for desktop surfaces. */
export function OrgBillingContext(
	props: Omit<OrgBillingContextViewProps, "organizationName" | "plan"> & {
		organizationName?: string | null;
		plan?: PlanTier | null;
	}
) {
	const { organization, plan } = useOrgBillingStatus();
	return (
		<OrgBillingContextView
			{...props}
			organizationName={props.organizationName ?? organization?.name ?? null}
			plan={props.plan ?? plan}
		/>
	);
}
