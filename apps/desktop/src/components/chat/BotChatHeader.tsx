import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Avatar } from "@ryu/ui/components/avatar.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import { AgentAvatar, engineForAgent } from "@/src/lib/agent-logos.tsx";
import type { AgentSummary } from "@/src/lib/api/agents.ts";

type BotChatHeaderAgent = Pick<
	AgentSummary,
	"avatarGlyph" | "avatarUrl" | "builtIn" | "engine" | "id" | "name" | "title"
>;

const FALLBACK_AGENT: BotChatHeaderAgent = {
	avatarGlyph: null,
	avatarUrl: null,
	builtIn: true,
	engine: "ryu",
	id: "ryu",
	name: "Ryu",
	title: "Ryu Bot",
};

/**
 * The Bot-mode identity row above an active conversation. It intentionally
 * stays present for both a new chat and an existing thread so the managed
 * assistant remains the visual anchor while the transcript changes below it.
 */
export function BotChatHeader({
	agent,
	clearTitleBar = true,
	className,
}: {
	agent?: BotChatHeaderAgent | null;
	/** Storyboards can disable this when they do not render the desktop title bar. */
	clearTitleBar?: boolean;
	className?: string;
}) {
	const currentAgent = agent ?? FALLBACK_AGENT;
	const name = currentAgent.name.trim() || FALLBACK_AGENT.name;

	return (
		<header
			aria-label={`Chat with ${name}`}
			className={cn(
				"flex shrink-0 flex-col items-center gap-1.5 px-4 pb-2",
				clearTitleBar ? "pt-12" : "pt-3",
				className
			)}
			data-testid="bot-chat-header"
		>
			<div data-testid="bot-chat-header-avatar">
				<Avatar
					aria-hidden="true"
					className="bg-muted/60 shadow-sm ring-1 ring-border/30 after:hidden"
					size="lg"
				>
					<AgentAvatar
						avatarUrl={currentAgent.avatarUrl}
						className="size-full rounded-full object-contain"
						engine={engineForAgent(currentAgent)}
						glyph={currentAgent.avatarGlyph}
						size="40px"
					/>
				</Avatar>
			</div>
			<div
				className="inline-flex max-w-[18rem] items-center gap-1 rounded-full bg-muted/80 px-3 py-1 text-foreground shadow-sm ring-1 ring-border/30"
				data-testid="bot-chat-header-name"
			>
				<span className="truncate font-medium text-sm">{name}</span>
				<HugeiconsIcon
					aria-hidden="true"
					className="size-3 shrink-0 text-muted-foreground"
					icon={ArrowDown01Icon}
					strokeWidth={2}
				/>
			</div>
		</header>
	);
}
