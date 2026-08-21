/* @jsxImportSource @opentui/react */
import { Markdown } from "@/components/ui/markdown.tsx";
import { useTheme, useUnicode } from "@/components/ui/theme-provider.tsx";
import { ThinkingBlock } from "@/components/ui/thinking-block";
import { ToolCall } from "@/components/ui/tool-call";
import type { ChatPart } from "../core/chatTranscript.ts";
import {
	boundTerminalText,
	completedTodoCount,
	formatToolOutput,
	TRANSCRIPT_LIMITS,
	todoStatusPresentation,
	toolArgumentsForPresentation,
} from "../core/transcriptPresentation.ts";

export function TranscriptParts({ parts }: { parts: ChatPart[] }) {
	const theme = useTheme();
	return (
		<box flexDirection="column" gap={1}>
			{parts.map((part, index) => {
				switch (part.type) {
					case "text": {
						const presentation = boundTerminalText(part.text, {
							label: "message",
							maxChars: TRANSCRIPT_LIMITS.markdownChars,
							maxLines: TRANSCRIPT_LIMITS.markdownLines,
						});
						return (
							<box flexDirection="column" key={`text-${index}`}>
								<Markdown>{presentation.text}</Markdown>
								{presentation.truncated ? (
									<text fg={theme.colors.mutedForeground}>
										[message output is bounded]
									</text>
								) : null}
							</box>
						);
					}
					case "reasoning":
						return (
							<ThinkingBlock
								content={
									boundTerminalText(part.text, {
										label: "thinking",
										maxChars: TRANSCRIPT_LIMITS.thinkingChars,
										maxLines: TRANSCRIPT_LIMITS.thinkingLines,
									}).text
								}
								defaultCollapsed
								key={`reasoning-${index}`}
								label="Thinking"
								streaming={index === parts.length - 1}
							/>
						);
					case "tool": {
						const args = toolArgumentsForPresentation(
							part.name,
							part.args,
							part.result
						);
						return (
							<ToolCall
								args={args}
								collapsible
								defaultCollapsed
								key={`tool-${part.toolCallId ?? index}`}
								name={part.name}
								result={formatToolOutput(part.result)}
								status={part.status}
							/>
						);
					}
					case "todo":
						return <TodoPart key={`todo-${index}`} todos={part.todos} />;
				}
			})}
		</box>
	);
}

function TodoPart({ todos }: { todos: { content: string; status: string }[] }) {
	const theme = useTheme();
	const unicode = useUnicode();
	const completed = completedTodoCount(todos);
	const contentRows = Math.max(1, todos.length);
	return (
		<box
			borderColor={theme.colors.border}
			borderStyle="single"
			flexDirection="column"
			height={contentRows + 3}
			paddingLeft={1}
			paddingRight={1}
		>
			<box flexDirection="row" gap={1} height={1}>
				<text fg={theme.colors.primary}>
					<b>Plan</b>
				</text>
				<text fg={theme.colors.mutedForeground}>
					{`${completed}/${todos.length} complete`}
				</text>
			</box>
			{todos.length === 0 ? (
				<text fg={theme.colors.mutedForeground} height={1}>
					No tasks yet
				</text>
			) : (
				todos.map((todo, index) => {
					const status = todoStatusPresentation(todo.status, unicode);
					const content = boundTerminalText(todo.content, {
						label: "todo",
						maxChars: TRANSCRIPT_LIMITS.todoChars,
						maxLines: TRANSCRIPT_LIMITS.todoLines,
					});
					return (
						<box
							flexDirection="row"
							gap={1}
							height={1}
							key={`${todo.content}-${index}`}
						>
							<text fg={theme.colors[status.tone]}>{status.icon}</text>
							<text fg={theme.colors.foreground}>{content.text}</text>
						</box>
					);
				})
			)}
		</box>
	);
}
