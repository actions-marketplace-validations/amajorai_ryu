import { AvatarUploadCropper, settingsApi } from "@ryu/settings";
import { Button } from "@ryu/ui/components/button";
import { Input } from "@ryu/ui/components/input";
import { Label } from "@ryu/ui/components/label";
import { toast } from "@ryu/ui/components/sileo";
import { Textarea } from "@ryu/ui/components/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client.ts";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	DEFAULT_USER_PERSONALIZATION,
	getPreference,
	setPreference,
	USER_PERSONALIZATION_PREF_KEY,
	type UserPersonalization,
} from "@/src/lib/api/preferences.ts";
import { SettingsCard, SettingsSection } from "./shared/settings-items.tsx";

export function ProfileTab() {
	const queryClient = useQueryClient();
	const { data: sessionData, refetch: refetchSession } = useSession();
	const user = sessionData?.user;

	const [name, setName] = useState(user?.name ?? "");
	const [isSavingName, setIsSavingName] = useState(false);
	const activeNode = useActiveNode();
	const [personalization, setPersonalization] = useState<UserPersonalization>(
		DEFAULT_USER_PERSONALIZATION
	);
	const [savingPersonalization, setSavingPersonalization] = useState(false);
	useEffect(() => {
		void getPreference(
			toTarget(activeNode),
			USER_PERSONALIZATION_PREF_KEY
		).then((raw) => {
			if (!raw) {
				return;
			}
			try {
				setPersonalization({
					...DEFAULT_USER_PERSONALIZATION,
					...JSON.parse(raw),
				});
			} catch {
				// Ignore a corrupt local preference and keep the empty defaults.
			}
		});
	}, [activeNode]);
	const savePersonalization = async () => {
		setSavingPersonalization(true);
		try {
			await setPreference(
				toTarget(activeNode),
				USER_PERSONALIZATION_PREF_KEY,
				JSON.stringify(personalization)
			);
			toast.success("Personalization saved");
		} finally {
			setSavingPersonalization(false);
		}
	};

	// Session data loads asynchronously, so backfill the field once the name
	// arrives. Keyed on user?.name so it won't clobber in-progress edits.
	useEffect(() => {
		if (user?.name) {
			setName(user.name);
		}
	}, [user?.name]);

	const handleNameSave = async () => {
		if (!name.trim() || name === user?.name) {
			return;
		}
		setIsSavingName(true);
		try {
			await settingsApi.profile.updateName(name.trim());
			await refetchSession();
			toast.success("Name updated");
		} catch {
			toast.error("Couldn't update your name", {
				description: "Check your connection and try again.",
			});
		} finally {
			setIsSavingName(false);
		}
	};

	const avatarUrl = user?.image ?? null;

	return (
		<div className="space-y-6">
			<SettingsSection title="Profile photo">
				<SettingsCard>
					<AvatarUploadCropper
						currentAvatarUrl={avatarUrl}
						onUploadComplete={() => {
							refetchSession();
							queryClient.invalidateQueries({ queryKey: ["session"] });
						}}
						userName={user?.name}
					/>
				</SettingsCard>
			</SettingsSection>

			<SettingsSection title="Display name">
				<SettingsCard className="flex gap-2">
					<Label className="sr-only" htmlFor="display-name">
						Display Name
					</Label>
					<Input
						id="display-name"
						maxLength={50}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								handleNameSave();
							}
						}}
						placeholder="Your name"
						value={name}
					/>
					<Button
						disabled={isSavingName || !name.trim() || name === user?.name}
						onClick={handleNameSave}
						size="sm"
					>
						{isSavingName ? "Saving…" : "Save"}
					</Button>
				</SettingsCard>
			</SettingsSection>

			<SettingsSection
				caption="To change your email, go to the Account tab."
				title="Email"
			>
				<SettingsCard>
					<Label className="sr-only" htmlFor="email">
						Email
					</Label>
					<Input
						className="bg-muted"
						disabled
						id="email"
						value={user?.email ?? ""}
					/>
				</SettingsCard>
			</SettingsSection>

			<SettingsSection
				caption="These details are added to the agent context on this node. They are not shared with your organization."
				title="About you"
			>
				<SettingsCard className="space-y-3">
					<Input
						aria-label="Nickname"
						onChange={(e) =>
							setPersonalization({
								...personalization,
								nickname: e.target.value,
							})
						}
						placeholder="Nickname"
						value={personalization.nickname}
					/>
					<Input
						aria-label="Occupation"
						onChange={(e) =>
							setPersonalization({
								...personalization,
								occupation: e.target.value,
							})
						}
						placeholder="Occupation"
						value={personalization.occupation}
					/>
					<Textarea
						aria-label="More about you"
						onChange={(e) =>
							setPersonalization({
								...personalization,
								aboutYou: e.target.value,
							})
						}
						placeholder="More about you"
						value={personalization.aboutYou}
					/>
					<Textarea
						aria-label="About your organization"
						onChange={(e) =>
							setPersonalization({
								...personalization,
								aboutOrganization: e.target.value,
							})
						}
						placeholder="About your organization"
						value={personalization.aboutOrganization}
					/>
					<Button
						disabled={savingPersonalization}
						onClick={savePersonalization}
						size="sm"
					>
						{savingPersonalization ? "Saving…" : "Save personalization"}
					</Button>
				</SettingsCard>
			</SettingsSection>
		</div>
	);
}
