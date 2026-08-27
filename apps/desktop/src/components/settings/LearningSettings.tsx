// apps/desktop/src/components/settings/LearningSettings.tsx
//
// Consent controls for the Learning app: the on-device skill-synthesis loop
// (`learning.skills-enabled`, default OFF) and the heavier rate-and-retrain loop
// (`learning.enabled`, default OFF). Both persist as Core preferences; the
// defaults live in `lib/api/preferences.ts`, not here.
//
// The tab is manifest-registered — `contributes.settings_tabs` on
// `@ryu/learning`, node scope — and bound to this component by plugin id in
// EntitySettings. The app is pre-installed because Core's scheduler runs the skill
// synthesis pass off `learning.skills-enabled` alone (default OFF), regardless of
// the app record — only the HTTP surface is gated — so the consent control has to
// exist wherever that capture does.

import { toast } from "@ryu/ui/components/sileo";
import { Switch } from "@ryu/ui/components/switch";
import { useCallback, useEffect, useState } from "react";
import { type ApiTarget, toTarget } from "@/src/lib/api/client.ts";
import {
	getLearningEnabled,
	getLearningSkillsEnabled,
	setLearningEnabled,
	setLearningSkillsEnabled,
} from "@/src/lib/api/preferences.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import {
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

function activeTarget(): ApiTarget {
	return toTarget(useNodeStore.getState().getActiveNode());
}

export function LearningSettings() {
	const [learningEnabled, setLearningEnabledState] = useState(false);
	// The local skills loop defaults ON (on-device, inbox-gated); seed the
	// Seed both consent controls to OFF so no capture occurs before Core answers.
	const [skillsEnabled, setSkillsEnabledState] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const target = activeTarget();
		Promise.all([getLearningEnabled(target), getLearningSkillsEnabled(target)])
			.then(([learning, skills]) => {
				if (cancelled) {
					return;
				}
				setLearningEnabledState(learning);
				setSkillsEnabledState(skills);
			})
			// A failed read leaves the seeded defaults on screen: for a consent
			// control, reachable-with-defaults beats an error card that hides it.
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	const handleLearning = useCallback(async (next: boolean) => {
		setLearningEnabledState(next); // optimistic
		try {
			await setLearningEnabled(activeTarget(), next);
		} catch {
			setLearningEnabledState(!next);
			toast.error("Couldn't save your learning choice", {
				description: "Check your connection and try again.",
			});
		}
	}, []);
	const handleSkills = useCallback(async (next: boolean) => {
		setSkillsEnabledState(next); // optimistic
		try {
			await setLearningSkillsEnabled(activeTarget(), next);
		} catch {
			setSkillsEnabledState(!next);
			toast.error("Couldn't save your skill-learning choice", {
				description: "Check your connection and try again.",
			});
		}
	}, []);

	return (
		<div className="space-y-6">
			<SettingsSection
				caption="Ryu learns from your conversations at two levels: a private one that never leaves this device, and a heavier one you opt into. You can leave out any individual conversation, and excluded conversations are never used."
				title="Learn from my conversations"
			>
				<SettingsGroup>
					<SettingsItem
						actions={
							<Switch
								checked={skillsEnabled}
								id="learning-skills-enabled"
								onCheckedChange={handleSkills}
							/>
						}
						description="Off by default. When enabled, Ryu distills reusable skills from your chats on this device and proposes them in your Inbox for approval before they go live."
						title="Learn skills from my chats"
					/>
					<SettingsItem
						actions={
							<Switch
								checked={learningEnabled}
								id="learning-enabled"
								onCheckedChange={handleLearning}
							/>
						}
						description="Off by default. Also rate your conversations with a stronger model and, on a device with a capable graphics card, fine-tune your local model on your best ones. Rating sends conversation text to that model, which may run in the cloud, so this stays opt-in."
						title="Train my local model"
					/>
				</SettingsGroup>
			</SettingsSection>
		</div>
	);
}
