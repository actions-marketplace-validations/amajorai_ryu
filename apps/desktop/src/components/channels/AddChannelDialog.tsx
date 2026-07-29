import type { AgentOption } from "@ryu/blocks/desktop/channels";
import {
	CHANNEL_LABELS,
	CHANNEL_SETUP,
	CHANNEL_TYPES,
	type ChannelType,
	DEFAULT_GROUP_REPLY_MODE,
	GROUP_REPLY_LABELS,
	GROUP_REPLY_MODES,
	type GroupReplyMode,
	REQUIRED_SECRETS,
	SECRET_LABELS,
} from "@ryu/blocks/desktop/channels";
import { Button } from "@ryu/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog";
import { Input } from "@ryu/ui/components/input";
import { Label } from "@ryu/ui/components/label";
import {
	NativeSelect,
	NativeSelectOption,
} from "@ryu/ui/components/native-select";
import { Spinner } from "@ryu/ui/components/spinner";
import { Switch } from "@ryu/ui/components/switch";
import { Textarea } from "@ryu/ui/components/textarea";
import { useCallback, useState } from "react";
import { ScrollFadeEffect } from "@/src/components/ui/scroll-fade-effect.tsx";

const DEFAULT_AGENT = "__default__";
const TEAM_PREFIX = "team:";

interface FormState {
	agentId: string;
	channelType: ChannelType;
	enabled: boolean;
	groupReplyMode: GroupReplyMode;
	model: string;
	name: string;
	secrets: Record<string, string>;
	systemPrompt: string;
}

function emptyForm(): FormState {
	return {
		channelType: "telegram",
		name: "",
		agentId: DEFAULT_AGENT,
		model: "",
		systemPrompt: "",
		groupReplyMode: DEFAULT_GROUP_REPLY_MODE,
		enabled: false,
		secrets: {},
	};
}

export function AddChannelDialog({
	open,
	onOpenChange,
	agents = [],
	teams = [],
	onCreate,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	agents: AgentOption[];
	teams?: AgentOption[];
	onCreate: (input: {
		channelType: ChannelType;
		name: string;
		secrets: Record<string, string>;
		agentId: string | null;
		teamId: string | null;
		groupReplyMode: GroupReplyMode;
		model: string | null;
		systemPrompt: string | null;
		enabled: boolean;
	}) => Promise<boolean>;
}) {
	const [form, setForm] = useState<FormState>(emptyForm);
	const [saving, setSaving] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	const requiredKeys = REQUIRED_SECRETS[form.channelType];
	const setup = CHANNEL_SETUP[form.channelType];

	const handleSave = useCallback(async () => {
		setFormError(null);
		if (!form.name.trim()) {
			setFormError("Name is required.");
			return;
		}

		let agentId: string | null = null;
		let teamId: string | null = null;
		if (form.agentId.startsWith(TEAM_PREFIX)) {
			teamId = form.agentId.slice(TEAM_PREFIX.length);
		} else if (form.agentId !== DEFAULT_AGENT) {
			agentId = form.agentId;
		}

		const secrets: Record<string, string> = {};
		for (const [key, value] of Object.entries(form.secrets)) {
			if (value.trim()) {
				secrets[key] = value.trim();
			}
		}

		const missing = requiredKeys.filter((k) => !secrets[k]);
		if (missing.length > 0) {
			setFormError(
				`Missing required: ${missing
					.map((k) => SECRET_LABELS[k] ?? k)
					.join(", ")}`
			);
			return;
		}

		setSaving(true);
		try {
			const ok = await onCreate({
				channelType: form.channelType,
				name: form.name.trim(),
				secrets,
				agentId,
				teamId,
				groupReplyMode: form.groupReplyMode,
				model: form.model.trim() || null,
				systemPrompt: form.systemPrompt.trim() || null,
				enabled: form.enabled,
			});
			if (ok) {
				setForm(emptyForm());
				onOpenChange(false);
			}
		} finally {
			setSaving(false);
		}
	}, [form, requiredKeys, onCreate, onOpenChange]);

	return (
		<Dialog
			onOpenChange={(v) => {
				if (!v) {
					setForm(emptyForm());
				}
				onOpenChange(v);
			}}
			open={open}
		>
			<DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>New channel bot</DialogTitle>
				</DialogHeader>

				<ScrollFadeEffect className="min-h-0 flex-1">
					<div className="space-y-4 pb-1">
						<div className="space-y-1.5">
							<Label htmlFor="channel-name">Name</Label>
							<Input
								id="channel-name"
								onChange={(e) =>
									setForm((f) => ({ ...f, name: e.target.value }))
								}
								placeholder="e.g. Support bot"
								value={form.name}
							/>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="channel-type">Platform</Label>
							<NativeSelect
								id="channel-type"
								onChange={(e) =>
									setForm((f) => ({
										...f,
										channelType: e.target.value as ChannelType,
										secrets: {},
									}))
								}
								value={form.channelType}
							>
								{CHANNEL_TYPES.map((t) => (
									<NativeSelectOption key={t} value={t}>
										{CHANNEL_LABELS[t]}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</div>

						<div className="space-y-3 rounded-lg border bg-card p-4">
							<p className="font-medium text-sm">Credentials</p>
							<p className="text-muted-foreground text-xs">{setup.note}</p>
							{requiredKeys.map((key) => {
								const help = setup.secretHelp[key];
								return (
									<div className="space-y-1.5" key={key}>
										<Label htmlFor={`dialog-secret-${key}`}>
											{SECRET_LABELS[key] ?? key}
										</Label>
										<Input
											aria-describedby={
												help ? `dialog-secret-${key}-help` : undefined
											}
											autoComplete="off"
											id={`dialog-secret-${key}`}
											onChange={(e) =>
												setForm((f) => ({
													...f,
													secrets: { ...f.secrets, [key]: e.target.value },
												}))
											}
											placeholder="Paste value"
											type="password"
											value={form.secrets[key] ?? ""}
										/>
										{help ? (
											<p
												className="text-muted-foreground text-xs"
												id={`dialog-secret-${key}-help`}
											>
												{help}
											</p>
										) : null}
									</div>
								);
							})}
							<p className="text-muted-foreground text-xs">
								Values are stored encrypted and never shown again.
							</p>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="channel-agent">Routes to</Label>
							<NativeSelect
								id="channel-agent"
								onChange={(e) =>
									setForm((f) => ({ ...f, agentId: e.target.value }))
								}
								value={form.agentId}
							>
								<NativeSelectOption value={DEFAULT_AGENT}>
									Default agent
								</NativeSelectOption>
								{agents.length > 0 ? (
									<optgroup label="Agents">
										{agents.map((a) => (
											<NativeSelectOption key={a.id} value={a.id}>
												{a.name}
											</NativeSelectOption>
										))}
									</optgroup>
								) : null}
								{teams.length > 0 ? (
									<optgroup label="Teams">
										{teams.map((t) => (
											<NativeSelectOption
												key={t.id}
												value={`${TEAM_PREFIX}${t.id}`}
											>
												{t.name}
											</NativeSelectOption>
										))}
									</optgroup>
								) : null}
							</NativeSelect>
							<p className="text-muted-foreground text-xs">
								Pick a single agent, or a team — the team's lead agent
								orchestrates and calls the other members to answer.
							</p>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="channel-model">Model override (optional)</Label>
							<Input
								id="channel-model"
								onChange={(e) =>
									setForm((f) => ({ ...f, model: e.target.value }))
								}
								placeholder="Leave blank to use the agent's model"
								value={form.model}
							/>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="channel-prompt">System prompt (optional)</Label>
							<Textarea
								id="channel-prompt"
								onChange={(e) =>
									setForm((f) => ({ ...f, systemPrompt: e.target.value }))
								}
								placeholder="Override the agent's persona for this bot"
								rows={3}
								value={form.systemPrompt}
							/>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="channel-group-reply">Group replies</Label>
							<NativeSelect
								id="channel-group-reply"
								onChange={(e) =>
									setForm((f) => ({
										...f,
										groupReplyMode: e.target.value as GroupReplyMode,
									}))
								}
								value={form.groupReplyMode}
							>
								{GROUP_REPLY_MODES.map((mode) => (
									<NativeSelectOption key={mode} value={mode}>
										{GROUP_REPLY_LABELS[mode]}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</div>

						<div className="flex items-center justify-between rounded-lg border bg-card p-4">
							<div>
								<p className="font-medium text-sm">Enabled</p>
								<p className="text-muted-foreground text-xs">
									The gateway registers enabled bots when it starts.
								</p>
							</div>
							<Switch
								aria-label="Enable channel"
								checked={form.enabled}
								onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
							/>
						</div>

						{formError ? (
							<p className="text-destructive text-sm">{formError}</p>
						) : null}
					</div>
				</ScrollFadeEffect>

				<DialogFooter>
					<Button onClick={() => onOpenChange(false)} variant="ghost">
						Cancel
					</Button>
					<Button
						disabled={saving}
						onClick={() => {
							handleSave().catch(() => undefined);
						}}
					>
						{saving ? <Spinner className="size-4" /> : null}
						Create bot
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
