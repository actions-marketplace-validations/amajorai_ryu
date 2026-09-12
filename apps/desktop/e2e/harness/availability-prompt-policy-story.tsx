import { AgentAvailabilityProvider } from "@ryu/blocks/desktop/agent-availability";
import { AgentChat } from "@ryu/blocks/desktop/agent-elements/agent-chat";
import type { UIMessage } from "ai";
import { createRoot } from "react-dom/client";
import { AvailabilityStatusButton } from "../../src/components/layout/AvailabilityMenu.tsx";
import { AvailabilitySettings } from "../../src/components/settings/AvailabilitySettings.tsx";
import { useUserAvailability } from "../../src/hooks/useUserAvailability.ts";
import "../../src/index.css";

const messages: UIMessage[] = [
	{
		id: "availability-user",
		role: "user",
		parts: [
			{
				text: "Review the migration and continue when it is safe.",
				type: "text",
			},
		],
	},
	{
		id: "availability-question",
		role: "assistant",
		parts: [
			{
				text: "I found two safe migration paths and need your preference before I continue.",
				type: "text",
			},
			{
				input: {
					questions: [
						{
							description:
								"The first option keeps the current schema and rolls out in one pass.",
							kind: "single",
							options: [
								{
									id: "safe-rollout",
									label: "Safe rollout",
								},
								{
									id: "fast-cutover",
									label: "Fast cutover",
								},
							],
							title: "Which path should I use?",
						},
					],
					totalQuestions: 1,
				},
				state: "input-available",
				toolCallId: "availability-question-call",
				type: "tool-Question",
			},
		],
	},
] as unknown as UIMessage[];

function AvailabilityStatusControl() {
	return <AvailabilityStatusButton />;
}

function PromptPreview() {
	const availability = useUserAvailability();

	return (
		<section
			className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm"
			data-testid="prompt-preview"
		>
			<div className="flex items-start justify-between gap-4 border-border/70 border-b px-5 py-4">
				<div className="min-w-0">
					<p className="font-medium text-sm">Live prompt behavior</p>
					<p className="mt-1 text-muted-foreground text-xs">
						The pending question stays available while your interruption policy
						changes.
					</p>
				</div>
				<output
					className="shrink-0 rounded-full bg-muted px-2 py-1 font-medium text-muted-foreground text-xs"
					data-testid="prompt-location"
				>
					{availability.status === "online" ? "Composer" : "Transcript"}
				</output>
			</div>
			<div className="min-h-0 flex-1 p-2">
				<AgentChat
					messages={messages}
					onSend={() => undefined}
					onStop={() => undefined}
					status="ready"
				/>
			</div>
		</section>
	);
}

function Story() {
	const availability = useUserAvailability();

	return (
		<AgentAvailabilityProvider status={availability.status}>
			<main className="min-h-screen bg-background p-6 text-foreground">
				<div className="mx-auto flex max-w-6xl flex-col gap-6">
					<header className="flex items-end justify-between gap-6">
						<div className="min-w-0">
							<p className="font-medium text-primary text-xs uppercase tracking-[0.16em]">
								Ryu Desktop
							</p>
							<h1 className="mt-1 font-heading font-semibold text-3xl tracking-tight">
								Availability & prompt policy
							</h1>
							<p className="mt-2 max-w-2xl text-muted-foreground text-sm">
								Choose when Ryu may ask for a decision. Away and Do not disturb
								keep human-input prompts available without taking over your
								composer.
							</p>
						</div>
					</header>
					<div className="grid min-h-[650px] gap-6 lg:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.35fr)]">
						<section className="rounded-3xl border border-border/70 bg-sidebar p-5 shadow-sm">
							<AvailabilitySettings />
						</section>
						<PromptPreview />
					</div>
					<footer
						className="flex items-center justify-between rounded-2xl border border-border/70 bg-sidebar px-3 py-2 shadow-sm"
						data-testid="user-nav-preview"
					>
						<div className="flex items-center gap-2">
							<span className="flex size-7 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground text-xs">
								J
							</span>
							<div>
								<p className="font-medium text-sm">Jiawei</p>
								<p className="text-muted-foreground text-xs">User nav</p>
							</div>
						</div>
						<AvailabilityStatusControl />
					</footer>
					<output className="sr-only" data-testid="availability-status">
						{availability.status}
					</output>
				</div>
			</main>
		</AgentAvailabilityProvider>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
