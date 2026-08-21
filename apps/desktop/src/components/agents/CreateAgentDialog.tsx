import { MagicWand01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { CHANNEL_LABELS, type ChannelType } from "@ryu/blocks/desktop/channels";
import { Button } from "@ryu/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog";
import { EmployeeBadge } from "@ryu/ui/components/employee-badge";
import { Logo } from "@ryu/ui/components/logo";
import { toast } from "@ryu/ui/components/sileo";
import { Switch } from "@ryu/ui/components/switch";
import { useTheme } from "next-themes";
import { useEffect, useId, useState } from "react";
import {
	type AgentAvatarValue,
	AgentImageField,
} from "@/src/components/agents/AgentImageField.tsx";
import { AgentSetupComposer } from "@/src/components/agents/AgentSetupComposer.tsx";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { useAgents } from "@/src/hooks/useAgents.ts";
import { ALL_MCP_TOOLS } from "@/src/lib/agent-capabilities.ts";
import { agentEngineOptionId } from "@/src/lib/agent-engine.ts";
import {
	buildAgentNamePrompt,
	extractGeneratedAgentName,
	pickCommonAgentName,
} from "@/src/lib/agent-name.ts";
import { buildNewAgentChatSeed } from "@/src/lib/agent-onboarding.ts";
import { glyphToPersonaFields } from "@/src/lib/agent-persona.ts";
import { chatHeaders, chatStreamUrl } from "@/src/lib/api/chat.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import { getLaneAgentSelection } from "@/src/lib/api/preferences.ts";
import { useChannelSetupDialog } from "@/src/store/useChannelSetupDialog.ts";
import { useCreateAgentDialog } from "@/src/store/useCreateAgentDialog.ts";

// "New agent", as a dialog rather than a whole tab.
//
// Creating an agent needed three facts — what it is called, what it should do,
// and what it looks like — but the entry point opened the full editor, a page
// with every advanced control on it. This asks for the three, shows the agent's
// badge taking shape as you type, and hands off to that editor once the agent
// actually exists (so the advanced controls have something to edit).
//
// Laid out like the waitlist queue on purpose: the card on the left is the thing
// worth looking at, the fields on the right are what change it. Same field and
// button sizes as that screen — `h-16 bg-muted` inputs, `size="lg"` buttons.

const NAME_MAX_LENGTH = 64;
const TITLE_MAX_LENGTH = 48;

// Self-contained, like `AgentAutoRoutingEditor`: it reads its own open state
// from the store and does its own routing, so the single mount site takes no
// props and no entry point has to thread callbacks through.
export function CreateAgentDialog() {
	const { open, setOpen } = useCreateAgentDialog();
	const { openTab } = useTabsContext();
	const { resolvedTheme } = useTheme();
	const { agents, create } = useAgents();
	const { openChannelSetup } = useChannelSetupDialog();
	const activeNode = useActiveNode();
	const nameId = useId();
	const titleId = useId();

	const [name, setName] = useState(() => pickCommonAgentName());
	const [title, setTitle] = useState("");
	const [instructions, setInstructions] = useState("");
	const [engine, setEngine] = useState("");
	const [model, setModel] = useState("");
	const [modelEngine, setModelEngine] = useState<string | null>(null);
	const [avatar, setAvatar] = useState<AgentAvatarValue>(null);
	const [submitting, setSubmitting] = useState(false);
	const [generatingName, setGeneratingName] = useState(false);
	const [autoSetupTelegram, setAutoSetupTelegram] = useState(true);
	const [autoSetupDiscord, setAutoSetupDiscord] = useState(false);
	const [autoSetupWhatsApp, setAutoSetupWhatsApp] = useState(false);

	const trimmedName = name.trim();
	const canSubmit = trimmedName.length > 0 && !submitting;

	useEffect(() => {
		if (engine || agents.length === 0) {
			return;
		}
		const defaultAgent =
			agents.find((agent) => agent.id === "ryu") ??
			agents.find((agent) => agent.recommended) ??
			agents.find((agent) => agent.builtIn);
		const defaultEngine = defaultAgent
			? agentEngineOptionId(defaultAgent)
			: null;
		if (defaultEngine) {
			setEngine(defaultEngine);
		}
	}, [agents, engine]);

	const reset = () => {
		setName(pickCommonAgentName());
		setTitle("");
		setInstructions("");
		setEngine("");
		setModel("");
		setModelEngine(null);
		setAvatar(null);
		setAutoSetupTelegram(true);
		setAutoSetupDiscord(false);
		setAutoSetupWhatsApp(false);
	};

	const rerollName = () => {
		setName((current) => pickCommonAgentName(current));
	};

	const generateName = async () => {
		if (generatingName || submitting || !instructions.trim()) {
			return;
		}
		setGeneratingName(true);
		try {
			const target = toTarget(activeNode);
			const localSelection = await getLaneAgentSelection(target, "local");
			const response = await fetch(chatStreamUrl(target), {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...chatHeaders(target),
				},
				body: JSON.stringify({
					agent_id: localSelection.agent_id || "ryu",
					conversation_id: `agent-name-${crypto.randomUUID()}`,
					enable_long_term: false,
					messages: [
						{
							content: buildAgentNamePrompt({
								instructions,
								title,
							}),
							role: "user",
						},
					],
					persist: false,
				}),
			});
			if (!response.ok) {
				throw new Error(`Local agent returned ${response.status}`);
			}
			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error("The local agent returned no response body");
			}
			const decoder = new TextDecoder();
			let buffer = "";
			let answer = "";
			const consume = (line: string) => {
				if (!line.startsWith("0:")) {
					return;
				}
				try {
					const token = JSON.parse(line.slice(2)) as unknown;
					if (typeof token === "string") {
						answer += token;
					}
				} catch {
					// Ignore metadata frames; the text frames are still usable.
				}
			};
			while (true) {
				const { done, value } = await reader.read();
				buffer += decoder.decode(value, { stream: !done });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					consume(line.trim());
				}
				if (done) {
					consume(buffer.trim());
					break;
				}
			}
			const generated = extractGeneratedAgentName(answer);
			if (!generated) {
				throw new Error("The local agent did not return a single human name");
			}
			setName(generated);
		} catch {
			setName((current) => pickCommonAgentName(current));
			toast.message("Couldn’t generate a name, so I picked another one");
		} finally {
			setGeneratingName(false);
		}
	};

	const submit = async (advanced: boolean) => {
		if (!canSubmit) {
			return;
		}
		setSubmitting(true);
		try {
			const agent = await create({
				description: null,
				engine: engine || null,
				name: trimmedName,
				title: title.trim(),
				model: model.trim() || null,
				chatModel: {
					engine: modelEngine,
					modelId: model.trim() || null,
				},
				// The avatar rides on the persona bundle, the same slot the full editor
				// writes. `glyphToPersonaFields` is what enforces the five sources'
				// mutual exclusivity — an uploaded image is only ONE of them, so
				// reading the glyph as a string would silently drop an icon, emoji,
				// dicebear or dither pick.
				persona: {
					display_name: null,
					tone: null,
					...glyphToPersonaFields(avatar),
				},
				systemPrompt: instructions.trim() || null,
				tools: [ALL_MCP_TOOLS],
			});
			const selectedChannelTypes = [
				autoSetupTelegram ? "telegram" : null,
				autoSetupDiscord ? "discord" : null,
				autoSetupWhatsApp ? "whatsapp" : null,
			].filter((value): value is ChannelType => value !== null);
			toast.success(`${trimmedName} created`);
			reset();
			setOpen(false);
			if (advanced) {
				openTab(`/agents/${agent.id}/edit`, { title: trimmedName });
			}
			// The first chat is a real, fresh tab. ChatPage consumes this one-shot
			// seed, selects the created agent, and sends the welcome request once the
			// chat transport is ready so the agent can introduce itself. It is opened
			// last so the chat is focused even when Advanced setup also opened the
			// editor.
			openTab("/chat", buildNewAgentChatSeed(agent.id, trimmedName));
			const firstChannelType = selectedChannelTypes[0];
			if (firstChannelType) {
				openChannelSetup({
					agentId: agent.id,
					agentName: trimmedName,
					channelType: firstChannelType,
				});
				const remainingCount = selectedChannelTypes.length - 1;
				toast.message(
					remainingCount > 0
						? `${CHANNEL_LABELS[firstChannelType]} setup is ready. Add the other ${remainingCount} selected channel${remainingCount === 1 ? "" : "s"} from Channels.`
						: `${CHANNEL_LABELS[firstChannelType]} setup is ready for ${trimmedName}.`
				);
			}
			if (advanced) {
				toast.message("Your agent is introducing itself in the chat tab");
			}
		} catch (error) {
			// One argument: this `toast` takes a string OR a full options object,
			// not sonner's (message, options) pair.
			toast.error({
				title: "Couldn't create that agent",
				description:
					error instanceof Error ? error.message : "Try again in a moment.",
			});
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>New agent</DialogTitle>
					<DialogDescription>
						Name it and tell it what to do. Everything else can be configured
						after.
					</DialogDescription>
				</DialogHeader>

				<div className="grid items-center gap-8 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
					{/* The badge the agent will carry, built from what has been typed so
					    far — the same card the Agents page shows once it exists. */}
					<div className="mx-auto w-full max-w-[17rem] md:mx-0">
						<EmployeeBadge
							employeeId="new"
							level={0}
							metalTheme={resolvedTheme === "light" ? "light" : "dark"}
							name={trimmedName || "New agent"}
							role={
								title.trim() ||
								(instructions.trim() ? "Ready to configure" : "Unconfigured")
							}
						/>
					</div>

					<div className="flex w-full flex-col gap-4">
						<div className="flex flex-col gap-2">
							<label
								className="text-muted-foreground text-xs"
								htmlFor={titleId}
							>
								Title badge
							</label>
							<input
								autoComplete="off"
								className="h-12 w-full rounded-3xl border-0 bg-muted px-4 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
								disabled={submitting}
								id={titleId}
								maxLength={TITLE_MAX_LENGTH}
								onChange={(event) => setTitle(event.target.value)}
								placeholder="e.g. CTO or Release engineer"
								value={title}
							/>
							<p className="text-muted-foreground text-xs">
								Shown beside the agent name in chat and the sidebar.
							</p>
						</div>

						<div className="flex flex-col gap-2">
							<span className="text-muted-foreground text-xs">Avatar</span>
							<AgentImageField
								disabled={submitting}
								fallback={<Logo size="24px" variant="outline" />}
								onChange={setAvatar}
								value={avatar}
							/>
						</div>

						<div className="flex flex-col gap-2">
							<label className="text-muted-foreground text-xs" htmlFor={nameId}>
								Name
							</label>
							<div className="flex items-center gap-2">
								<input
									autoComplete="off"
									className="h-16 min-w-0 flex-1 rounded-3xl border-0 bg-muted px-4 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
									disabled={submitting || generatingName}
									id={nameId}
									maxLength={NAME_MAX_LENGTH}
									onChange={(event) => setName(event.target.value)}
									placeholder="Release engineer"
									value={name}
								/>
								<Button
									aria-label="Pick another name"
									disabled={submitting || generatingName}
									onClick={rerollName}
									size="icon-lg"
									title="Pick another name"
									variant="secondary"
								>
									<HugeiconsIcon icon={Refresh01Icon} />
								</Button>
								<Button
									aria-label="Generate a name from the agent instructions"
									disabled={
										submitting || generatingName || !instructions.trim()
									}
									onClick={() => void generateName()}
									size="icon-lg"
									title="Use this after you set what the agent should do"
									variant="secondary"
								>
									<HugeiconsIcon
										className={generatingName ? "animate-spin" : undefined}
										icon={MagicWand01Icon}
									/>
								</Button>
							</div>
							<p className="text-muted-foreground text-xs">
								Start with a common name, reroll it, or use the magic wand after
								writing the instructions.
							</p>
						</div>

						<div className="flex flex-col gap-2">
							<span className="text-muted-foreground text-xs">
								Instructions &amp; model
							</span>
							<AgentSetupComposer
								agents={agents}
								disabled={submitting}
								engine={engine}
								instructions={instructions}
								model={model}
								modelEngine={modelEngine}
								onEngineChange={setEngine}
								onInstructionsChange={setInstructions}
								onModelChange={setModel}
								onModelEngineChange={setModelEngine}
								placeholder="What should this agent do, and how should it behave?"
							/>
						</div>

						<div className="space-y-3 rounded-2xl border bg-muted/30 p-4">
							<div>
								<p className="font-medium text-sm">
									Set up channels after creation
								</p>
								<p className="text-muted-foreground text-xs">
									The first selected setup opens automatically. Telegram can
									create a managed bot here; Discord and WhatsApp still need
									their own platform credentials.
								</p>
							</div>
							<div className="grid gap-2 sm:grid-cols-3">
								<label className="flex items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2 text-sm">
									<span>{CHANNEL_LABELS.telegram}</span>
									<Switch
										aria-label={`Set up ${CHANNEL_LABELS.telegram} after creation`}
										checked={autoSetupTelegram}
										disabled={submitting}
										onCheckedChange={setAutoSetupTelegram}
									/>
								</label>
								<label className="flex items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2 text-sm">
									<span>{CHANNEL_LABELS.discord}</span>
									<Switch
										aria-label={`Set up ${CHANNEL_LABELS.discord} after creation`}
										checked={autoSetupDiscord}
										disabled={submitting}
										onCheckedChange={setAutoSetupDiscord}
									/>
								</label>
								<label className="flex items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2 text-sm">
									<span>{CHANNEL_LABELS.whatsapp}</span>
									<Switch
										aria-label={`Set up ${CHANNEL_LABELS.whatsapp} after creation`}
										checked={autoSetupWhatsApp}
										disabled={submitting}
										onCheckedChange={setAutoSetupWhatsApp}
									/>
								</label>
							</div>
						</div>

						<div className="flex flex-col gap-2 sm:flex-row">
							<Button
								className="flex-1"
								disabled={!canSubmit}
								loading={submitting}
								onClick={() => submit(false)}
								size="lg"
								type="button"
							>
								Create agent
							</Button>
							<Button
								className="flex-1"
								disabled={!canSubmit}
								onClick={() => submit(true)}
								size="lg"
								type="button"
								variant="secondary"
							>
								Advanced setup
							</Button>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
