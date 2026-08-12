// apps/desktop/src/components/chat/MergedThreadPicker.tsx
//
// The composer control that decides WHICH thread a send lands in while the
// messaging-style merged agent view is open.
//
// This is the piece that keeps the merged view honest. Telegram's combined
// forum view has the same problem — one scroll, many topics — and solves it the
// same way: the transcript is stitched for reading, but every message you send
// still belongs to exactly one topic, and you pick it before sending. Nothing
// here merges or moves stored threads.

import { Add01Icon, Message01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@ryu/ui/components/dropdown-menu.tsx";
import type { Conversation } from "@/types/chat.ts";

/** The label the trigger shows when the composer is aimed at a thread that does
 *  not exist yet (nothing selected, or the user chose "New thread"). */
const NEW_THREAD_LABEL = "New thread";

export function MergedThreadPicker({
	activeConversationId,
	onNewThread,
	onSelectThread,
	threads,
}: {
	activeConversationId: string | null;
	/** Aim the composer at a thread that does not exist yet; the next send
	 *  creates it, exactly like opening a fresh chat with this agent. */
	onNewThread: () => void;
	onSelectThread: (conversationId: string) => void;
	threads: Conversation[];
}) {
	const active = threads.find((t) => t.id === activeConversationId);
	const label = active?.title ?? NEW_THREAD_LABEL;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<button
						aria-label="Choose which thread to send to"
						className="flex h-7 min-w-0 max-w-[12rem] items-center gap-1.5 rounded-lg px-2 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
						// A native title rather than a Tooltip wrapper: a Base UI tooltip
						// trigger wrapping a menu trigger fights over the same child render
						// slot, and the hint is not worth that risk.
						title={`Sending to "${label}". Every thread with this agent is shown above; pick which one this message joins.`}
						type="button"
					>
						<HugeiconsIcon className="size-3.5 shrink-0" icon={Message01Icon} />
						<span className="truncate">{label}</span>
					</button>
				}
			/>
			<DropdownMenuContent
				align="start"
				className="max-h-80 w-64 overflow-auto"
			>
				<DropdownMenuLabel>Send to thread</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					onValueChange={onSelectThread}
					value={activeConversationId ?? ""}
				>
					{threads.map((thread) => (
						<DropdownMenuRadioItem key={thread.id} value={thread.id}>
							<span className="truncate">{thread.title}</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				{threads.length > 0 ? <DropdownMenuSeparator /> : null}
				<DropdownMenuItem onClick={onNewThread}>
					<HugeiconsIcon className="mr-2 size-4" icon={Add01Icon} />
					{NEW_THREAD_LABEL}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
