/* @jsxImportSource @opentui/react */
import { Markdown } from "@/components/ui/markdown.tsx";
import { useTheme } from "@/components/ui/theme-provider.tsx";
import { ThinkingBlock } from "@/components/ui/thinking-block";
import { ToolCall, type ToolCallStatus } from "@/components/ui/tool-call";
import type { ChatPart } from "../core/chatTranscript.ts";

export function TranscriptParts({ parts }: { parts: ChatPart[] }) {
	return (
		<box flexDirection="column" gap={1}>
			{parts.map((part, index) => {
				switch (part.type) {
					case "text":
						return <Markdown key={`text-${index}`}>{part.text}</Markdown>;
					case "reasoning":
						return (
							<ThinkingBlock
								content={part.text}
								defaultCollapsed={false}
								key={`reasoning-${index}`}
							/>
						);
					case "tool":
						return (
							<ToolCall
								args={part.args}
								defaultCollapsed
								key={`tool-${index}`}
								name={part.name}
								result={part.result}
								status={part.status as ToolCallStatus}
							/>
						);
					case "todo":
						return <TodoPart key={`todo-${index}`} todos={part.todos} />;
				}
			})}
		</box>
	);
}

function TodoPart({ todos }: { todos: { content: string; status: string }[] }) {
	const theme = useTheme();
	return (
		<box
			borderColor={theme.colors.border}
			borderStyle="single"
			flexDirection="column"
			paddingLeft={1}
		>
			<text fg={theme.colors.mutedForeground}>Plan</text>
			{todos.map((todo, index) => (
				<text fg={theme.colors.foreground} key={`${todo.content}-${index}`}>
					{`${todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "•" : "○"} ${todo.content}`}
				</text>
			))}
		</box>
	);
}
