import { AuthorizedAppsSection } from "./oauth-apps/authorized-apps-section.tsx";
import { OwnedAppsSection } from "./oauth-apps/owned-apps-section.tsx";

export function OAuthAppsTab() {
	return (
		<div className="space-y-6">
			<OwnedAppsSection />
			<AuthorizedAppsSection />
		</div>
	);
}

export const AuthorizedAppsTab = OAuthAppsTab;
