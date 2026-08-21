import { useChatDisplayPrefs } from "@ryu/blocks/desktop/agent-elements/chat-display-prefs.tsx";
import { TextLoop } from "@ryu/ui/components/text-loop.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";

export function SidebarConversationPreview({
	className,
	states,
	testId,
}: {
	className?: string;
	states: string[];
	testId?: string;
}) {
	const { animationsEnabled } = useChatDisplayPrefs();

	return (
		<span
			className={cn(
				"block min-w-0 overflow-hidden whitespace-nowrap text-muted-foreground/70 text-xs",
				className
			)}
			data-testid={testId}
		>
			<TextLoop
				className="block min-w-0 max-w-full"
				interval={2.4}
				trigger={animationsEnabled}
			>
				{states}
			</TextLoop>
		</span>
	);
}
