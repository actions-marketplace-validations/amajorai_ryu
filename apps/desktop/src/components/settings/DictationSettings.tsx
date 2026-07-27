// apps/desktop/src/components/settings/DictationSettings.tsx
//
// Settings for system-wide dictation (the `apps-store/dictation` plugin): hold a
// global shortcut, speak, and the transcript is typed into whatever native app
// has OS focus. Agent-ask is a second mode: speak a question, run an agent, paste
// the answer. Island hosts the OS surface (shortcut registration, capture, insert);
// this page persists the cross-process `dictation` preference blob.

import { Input } from "@ryu/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select";
import { Switch } from "@ryu/ui/components/switch";
import { Textarea } from "@ryu/ui/components/textarea";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentSelectionField } from "@/components/agent-elements/input/agent-selection-field.tsx";
import { type ApiTarget, toTarget } from "@/src/lib/api/client.ts";
import {
	DEFAULT_DICTATION_ASK,
	DEFAULT_DICTATION_PREFS,
	type DictationInsertMode,
	type DictationMode,
	type DictationPrefs,
	getDictationPrefs,
	setDictationPrefs,
	VOICE_ENGINES,
	type VoiceEngine,
} from "@/src/lib/api/preferences.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import { AgentAccessPanel } from "./AgentAccessPanel.tsx";
import { ShortcutCapture } from "./shared/ShortcutCapture.tsx";
import {
	SettingsCard,
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

/** Activation-mode choices for dictation shortcuts. */
const DICTATION_MODE_OPTIONS: { value: DictationMode; label: string }[] = [
	{ value: "push-to-talk", label: "Hold to talk" },
	{ value: "toggle", label: "Press to start / stop" },
];

/** How dictated text lands in the focused app. */
const DICTATION_INSERT_OPTIONS: {
	value: DictationInsertMode;
	label: string;
}[] = [
	{ value: "type", label: "Type (synthetic keystrokes)" },
	{ value: "paste", label: "Paste (clipboard)" },
];

const IS_WINDOWS = navigator.userAgent.includes("Windows");

function activeTarget(): ApiTarget {
	return toTarget(useNodeStore.getState().getActiveNode());
}

export function DictationSettings() {
	const [prefs, setPrefs] = useState<DictationPrefs>(DEFAULT_DICTATION_PREFS);

	useEffect(() => {
		let cancelled = false;
		getDictationPrefs(activeTarget()).then((value) => {
			if (!cancelled) {
				setPrefs(value);
			}
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const writePrefs = useCallback((next: DictationPrefs) => {
		const withEnabled = { ...next, enabled: true };
		setPrefs(withEnabled);
		void setDictationPrefs(activeTarget(), withEnabled).catch(() => undefined);
	}, []);

	const sttEngineOptions = useMemo(
		() =>
			VOICE_ENGINES.map((e) => ({
				value: e.engine,
				label: e.label,
			})),
		[]
	);

	return (
		<div className="space-y-6">
			<SettingsSection
				caption={
					<>
						System-wide dictation types your speech into whatever app has focus.
						Unlike push-to-talk voice input (which runs an agent in the island),
						this just enters text — optionally cleaned up by a model first.
					</>
				}
				title="Dictation"
			>
				<SettingsCard>
					<p className="text-muted-foreground text-sm">
						Dictation is on because the <strong>Dictation</strong> plugin is
						enabled. To turn it off everywhere, disable the plugin in{" "}
						<strong>Settings → Plugins</strong>. The island companion hosts the
						OS surface (global shortcuts, capture, insert). The settings below
						tune what it does once it is on.
					</p>
				</SettingsCard>
			</SettingsSection>

			<SettingsSection
				caption="Hold the dictation shortcut, speak, and the transcript is typed into the focused app."
				title="Transcribe"
			>
				<SettingsGroup>
					<SettingsItem
						actions={
							<ShortcutCapture
								ariaLabel="Set dictation shortcut"
								onChange={(acc) => writePrefs({ ...prefs, shortcut: acc })}
								onReset={() =>
									writePrefs({
										...prefs,
										shortcut: DEFAULT_DICTATION_PREFS.shortcut,
									})
								}
								value={prefs.shortcut}
							/>
						}
						description="Global key to dictate into the focused app. Kept separate from the voice-input shortcut."
						title="Dictation shortcut"
					/>
					<SettingsItem
						actions={
							<Select
								items={DICTATION_MODE_OPTIONS}
								onValueChange={(v) =>
									writePrefs({ ...prefs, mode: v as DictationMode })
								}
								value={prefs.mode}
							>
								<SelectTrigger
									aria-label="Dictation activation mode"
									className="h-8 w-56 text-sm"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{DICTATION_MODE_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						}
						description={
							prefs.mode === "push-to-talk"
								? "Hold the shortcut to record; release to insert."
								: "Press once to start, again to stop and insert."
						}
						title="Activation"
					/>
					<SettingsItem
						actions={
							<Select
								items={sttEngineOptions}
								onValueChange={(v) =>
									writePrefs({ ...prefs, engine: v as VoiceEngine })
								}
								value={prefs.engine}
							>
								<SelectTrigger
									aria-label="Dictation engine"
									className="h-8 w-56 text-sm"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{sttEngineOptions.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						}
						description="Speech-to-text engine used for dictation."
						title="Engine"
					/>
					<SettingsItem
						actions={
							<Select
								items={DICTATION_INSERT_OPTIONS}
								onValueChange={(v) =>
									writePrefs({
										...prefs,
										insertMode: v as DictationInsertMode,
									})
								}
								value={prefs.insertMode}
							>
								<SelectTrigger
									aria-label="Dictation insertion method"
									className="h-8 w-56 text-sm"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{DICTATION_INSERT_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						}
						description={
							prefs.insertMode === "paste"
								? "Copies the text and sends the paste shortcut — instant even for long dictations."
								: "Types the text character by character. No clipboard clobber; works everywhere."
						}
						title="Insertion"
					/>
					{prefs.insertMode === "paste" ? (
						<>
							<SettingsItem
								actions={
									<Input
										aria-label="Paste command"
										className="h-8 w-56 text-sm"
										onChange={(e) =>
											writePrefs({ ...prefs, pasteKeys: e.target.value })
										}
										placeholder={
											IS_WINDOWS ? "ctrl+v (default)" : "cmd+v (default)"
										}
										value={prefs.pasteKeys}
									/>
								}
								description="Key combo to paste, `+`-joined (e.g. ctrl+v, cmd+shift+v). Empty uses the platform default."
								title="Paste command"
							/>
							<SettingsItem
								actions={
									<Switch
										aria-label="Restore clipboard after paste"
										checked={prefs.restoreClipboard}
										onCheckedChange={(v) =>
											writePrefs({ ...prefs, restoreClipboard: v })
										}
									/>
								}
								description="Put your previous clipboard back after pasting the dictation."
								title="Restore clipboard"
							/>
						</>
					) : null}
					<SettingsItem
						actions={
							<Switch
								aria-label="Auto-send after dictation"
								checked={prefs.autoSend}
								onCheckedChange={(v) => writePrefs({ ...prefs, autoSend: v })}
							/>
						}
						description="Press Enter after inserting — sends the message in a chat box (or adds a newline in an editor)."
						title="Auto-send (press Enter)"
					/>
					<SettingsItem
						actions={
							<Switch
								aria-label="Clean up dictation with a model"
								checked={prefs.postProcess.enabled}
								onCheckedChange={(v) =>
									writePrefs({
										...prefs,
										postProcess: {
											...prefs.postProcess,
											enabled: v,
										},
									})
								}
							/>
						}
						description="Run the raw transcript through a model to fix grammar/punctuation and drop filler words before it lands. Falls back to the raw text if the model is unavailable."
						title="Clean up with a model"
					/>
					{prefs.postProcess.enabled ? (
						<>
							<SettingsItem
								description="Pick an agent (uses its tools/Spaces) or a model for one-shot cleanup. Empty = fast local default."
								title="Cleanup agent or model"
							>
								<AgentSelectionField
									ariaLabel="Dictation cleanup agent or model"
									onChange={(selection) =>
										writePrefs({
											...prefs,
											postProcess: {
												...prefs.postProcess,
												selection,
											},
										})
									}
									placeholder="Default local model"
									target={activeTarget()}
									value={prefs.postProcess.selection}
								/>
							</SettingsItem>
							<SettingsItem
								actions={
									<Textarea
										aria-label="Dictation cleanup prompt"
										className="min-h-24 w-72 text-sm"
										onChange={(e) =>
											writePrefs({
												...prefs,
												postProcess: {
													...prefs.postProcess,
													prompt: e.target.value,
												},
											})
										}
										value={prefs.postProcess.prompt}
									/>
								}
								description="Instructions for the cleanup model. It sees this plus your raw transcript."
								title="Cleanup prompt"
							/>
						</>
					) : null}
				</SettingsGroup>
			</SettingsSection>

			<SettingsSection
				caption="Speak a question anywhere; an agent answers and the text is pasted into the focused app. Uses a separate shortcut from plain dictation."
				title="Agent ask"
			>
				<SettingsGroup>
					<SettingsItem
						actions={
							<Switch
								aria-label="Enable agent ask"
								checked={prefs.ask.enabled}
								onCheckedChange={(v) =>
									writePrefs({
										...prefs,
										ask: { ...prefs.ask, enabled: v },
									})
								}
							/>
						}
						description="Hold the agent-ask shortcut, ask a question, and paste the agent's answer."
						title="Agent ask"
					/>
					{prefs.ask.enabled ? (
						<>
							<SettingsItem
								actions={
									<ShortcutCapture
										ariaLabel="Set agent-ask shortcut"
										onChange={(acc) =>
											writePrefs({
												...prefs,
												ask: { ...prefs.ask, shortcut: acc },
											})
										}
										onReset={() =>
											writePrefs({
												...prefs,
												ask: {
													...prefs.ask,
													shortcut: DEFAULT_DICTATION_ASK.shortcut,
												},
											})
										}
										value={prefs.ask.shortcut}
									/>
								}
								description="Global key for agent-ask. Kept separate from the dictation shortcut."
								title="Agent-ask shortcut"
							/>
							<SettingsItem
								actions={
									<Select
										items={DICTATION_MODE_OPTIONS}
										onValueChange={(v) =>
											writePrefs({
												...prefs,
												ask: { ...prefs.ask, mode: v as DictationMode },
											})
										}
										value={prefs.ask.mode}
									>
										<SelectTrigger
											aria-label="Agent-ask activation mode"
											className="h-8 w-56 text-sm"
										>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{DICTATION_MODE_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								}
								description={
									prefs.ask.mode === "push-to-talk"
										? "Hold the shortcut to record; release to ask and paste the answer."
										: "Press once to start, again to stop, ask, and paste the answer."
								}
								title="Activation"
							/>
							<SettingsItem
								description="Prefer an agent when you want tool access (Spaces, Ghost, other apps). A model-only pick answers without tools."
								title="Agent"
							>
								<AgentSelectionField
									ariaLabel="Agent-ask agent or model"
									onChange={(selection) =>
										writePrefs({
											...prefs,
											ask: { ...prefs.ask, selection },
										})
									}
									placeholder="Default local model"
									target={activeTarget()}
									value={prefs.ask.selection}
								/>
							</SettingsItem>
							<SettingsItem
								actions={
									<Textarea
										aria-label="Agent-ask prompt"
										className="min-h-24 w-72 text-sm"
										onChange={(e) =>
											writePrefs({
												...prefs,
												ask: { ...prefs.ask, prompt: e.target.value },
											})
										}
										value={prefs.ask.prompt}
									/>
								}
								description="Instructions for the ask agent. It sees this plus your spoken question."
								title="Ask prompt"
							/>
						</>
					) : null}
				</SettingsGroup>
			</SettingsSection>

			{prefs.ask.enabled && prefs.ask.selection.agent_id.trim() ? (
				<AgentAccessPanel
					agentId={prefs.ask.selection.agent_id.trim()}
					target={activeTarget()}
				/>
			) : prefs.postProcess.enabled &&
				prefs.postProcess.selection.agent_id.trim() ? (
				<AgentAccessPanel
					agentId={prefs.postProcess.selection.agent_id.trim()}
					target={activeTarget()}
				/>
			) : null}
		</div>
	);
}
