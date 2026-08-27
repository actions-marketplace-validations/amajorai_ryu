/* @jsxImportSource @opentui/react */
// Groups tab - parity with apps/cli's Groups feature tab (main.rs refresh_feature_tab).
// Lists agent groups (name / id title, coordination-description subtitle, members count
// badge) from /api/teams. Browse-only in apps/cli: no Enter/'a' action is wired in
// feature_tab_action/secondary (group routing happens from the Chat tab's /group
// command), so this tab only lists.

import { featureListLoader } from "../core/featureList.ts";
import { ListTab } from "../ui/ListTab.tsx";
import type { TabProps } from "./types.ts";

const loadTeams = featureListLoader({
	path: "/api/teams",
	containerKeys: ["teams", "data"],
	titleKeys: ["name", "id"],
	subtitleKeys: ["coordination", "description"],
	badgeKeys: ["members"],
	idKeys: ["id"],
});

export function TeamsTab({ active }: TabProps) {
	return <ListTab active={active} emptyLabel="No groups" load={loadTeams} />;
}
