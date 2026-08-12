import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@ryu/ui/components/dropdown-menu.tsx";
import { toast } from "@ryu/ui/components/sileo.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronsUpDown, User } from "lucide-react";
import {
	getActiveOrgId,
	hasOrgAuth,
	listOrgs,
	setActiveOrg,
} from "@/src/lib/api/orgs.ts";

/**
 * The workspace picker that sits at the top of the settings dialog's SERVICES
 * group, directly above Billing.
 *
 * WHY IT IS HERE AND NOT IN THE TABS. Billing, Referrals, Teams and Credits are
 * all ORG-SCOPED — each resolves its org from the session's active organization
 * — but not one of them printed WHICH org it was showing. A user in two
 * workspaces read four screens of numbers with no way to tell whose they were,
 * and no way to change it without leaving for the web dashboard. Putting the
 * control at the head of the group makes the scope a property of the whole
 * section rather than a fact each tab would have to repeat (and could disagree
 * about).
 *
 * SWITCHING IS A SERVER MUTATION, not local state: `set-active` rewrites
 * `activeOrganizationId` on the session row that every org-scoped route already
 * reads. That is also why the whole query cache is dropped afterwards rather
 * than a hand-picked list of keys invalidated — the switch changes the meaning
 * of every org-scoped response in flight, and enumerating them here would leave
 * the next org-scoped tab someone adds silently stale.
 */

const ORGS_KEY = ["settings", "orgs"] as const;
const ACTIVE_ORG_KEY = ["settings", "orgs", "active"] as const;

export function ServicesOrgSwitcher() {
	const queryClient = useQueryClient();
	const authed = hasOrgAuth();

	const orgsQuery = useQuery({
		enabled: authed,
		queryFn: listOrgs,
		queryKey: ORGS_KEY,
	});
	const activeQuery = useQuery({
		enabled: authed,
		queryFn: getActiveOrgId,
		queryKey: ACTIVE_ORG_KEY,
	});

	const switchMutation = useMutation({
		mutationFn: setActiveOrg,
		onError: (error: unknown) =>
			toast.error({
				title:
					error instanceof Error ? error.message : "Couldn't switch workspace",
			}),
		onSuccess: async () => {
			// Everything org-scoped is now about a different org. See the note above
			// on why this is a blanket invalidation.
			await queryClient.invalidateQueries();
		},
	});

	const orgs = orgsQuery.data ?? [];
	// Nothing to switch BETWEEN: a solo user has exactly one org, and a picker
	// with one entry is a control that can only tell you what you already know.
	if (!authed || orgs.length < 2) {
		return null;
	}

	// The server's own fallback, mirrored: a session with no active org resolves
	// to the EARLIEST membership. Showing "Select…" instead would imply the tabs
	// below are unscoped, when they are already reading that org's numbers.
	const activeId = activeQuery.data ?? orgs[0]?.id ?? null;
	const active = orgs.find((org) => org.id === activeId) ?? orgs[0];

	return (
		<div className="px-2 pb-1">
			<DropdownMenu>
				<DropdownMenuTrigger
					className="flex w-full items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-60"
					disabled={switchMutation.isPending}
				>
					<Building2 className="size-3.5 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate">
						{active?.name ?? "Workspace"}
					</span>
					{switchMutation.isPending ? (
						<Spinner className="size-3.5 shrink-0" />
					) : (
						<ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
					)}
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-56">
					{orgs.map((org) => (
						<DropdownMenuItem
							key={org.id}
							onClick={() => {
								if (org.id !== activeId) {
									switchMutation.mutate(org.id);
								}
							}}
						>
							{/* The role is the fact that decides what the tabs below will let
							    this person DO — an org they are a plain member of shows the
							    same billing screen with every control disabled — so it is
							    worth the line it costs. */}
							<span className="mr-2 flex size-4 shrink-0 items-center justify-center">
								{org.id === activeId ? <Check className="size-3.5" /> : null}
							</span>
							<span className="min-w-0 flex-1 truncate">{org.name}</span>
							{org.role ? (
								<span className="ml-2 shrink-0 text-muted-foreground text-xs">
									{org.role}
								</span>
							) : null}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			<p className="mt-1 flex items-center gap-1 px-0.5 text-[11px] text-muted-foreground">
				<User className="size-3 shrink-0" />
				Billing, credits and referrals below are for this workspace.
			</p>
		</div>
	);
}

export default ServicesOrgSwitcher;
