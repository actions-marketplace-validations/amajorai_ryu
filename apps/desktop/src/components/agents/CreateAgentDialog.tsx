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
import { Spinner } from "@ryu/ui/components/spinner";
import { useTheme } from "next-themes";
import { useId, useState } from "react";
import {
	type AgentAvatarValue,
	AgentImageField,
} from "@/src/components/agents/AgentImageField.tsx";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { useAgents } from "@/src/hooks/useAgents.ts";
import { glyphToPersonaFields } from "@/src/lib/agent-persona.ts";
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

// Self-contained, like `AgentAutoRoutingEditor`: it reads its own open state
// from the store and does its own routing, so the single mount site takes no
// props and no entry point has to thread callbacks through.
export function CreateAgentDialog() {
	const { open, setOpen } = useCreateAgentDialog();
	const { openTab } = useTabsContext();
	const { resolvedTheme } = useTheme();
	const { create } = useAgents();
	const nameId = useId();
	const instructionsId = useId();

	const [name, setName] = useState("");
	const [instructions, setInstructions] = useState("");
	const [avatar, setAvatar] = useState<AgentAvatarValue>(null);
	const [submitting, setSubmitting] = useState(false);

	const trimmedName = name.trim();
	const canSubmit = trimmedName.length > 0 && !submitting;

	const reset = () => {
		setName("");
		setInstructions("");
		setAvatar(null);
	};

	const submit = async (advanced: boolean) => {
		if (!canSubmit) {
			return;
		}
		setSubmitting(true);
		try {
			const agent = await create({
				description: null,
				engine: null,
				name: trimmedName,
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
				tools: [],
			});
			toast.success(`${trimmedName} created`);
			reset();
			setOpen(false);
			// Either way we land on the agent's own page. "Advanced" is not a
			// different destination — the full editor IS the agent's page, and it
			// skips its new-agent wizard because the agent already exists.
			openTab(`/agents/${agent.id}/edit`, { title: trimmedName });
			if (advanced) {
				toast.message("Opening the full editor");
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
							role={instructions.trim() ? "Ready to configure" : "Unconfigured"}
						/>
					</div>

					<div className="flex w-full flex-col gap-4">
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
							<input
								autoComplete="off"
								className="h-16 w-full rounded-3xl border-0 bg-muted px-4 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
								disabled={submitting}
								id={nameId}
								maxLength={NAME_MAX_LENGTH}
								onChange={(event) => setName(event.target.value)}
								placeholder="Release engineer"
								value={name}
							/>
						</div>

						<div className="flex flex-col gap-2">
							<label
								className="text-muted-foreground text-xs"
								htmlFor={instructionsId}
							>
								Instructions
							</label>
							<textarea
								className="min-h-32 w-full resize-none rounded-3xl border-0 bg-muted px-4 py-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
								disabled={submitting}
								id={instructionsId}
								onChange={(event) => setInstructions(event.target.value)}
								placeholder="What should this agent do, and how should it behave?"
								value={instructions}
							/>
						</div>

						<div className="flex flex-col gap-2 sm:flex-row">
							<Button
								className="flex-1"
								disabled={!canSubmit}
								onClick={() => submit(false)}
								size="lg"
								type="button"
							>
								{submitting ? (
									<span className="flex items-center gap-2">
										<Spinner className="size-4" />
										Creating
									</span>
								) : (
									"Create agent"
								)}
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
