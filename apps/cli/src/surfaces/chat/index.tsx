/* @jsxImportSource @opentui/react */
// Chat surface - the reference home surface (path /chat), restructured toward the
// desktop AgentChat layout: an empty-state header with an agent/team mode picker,
// a scrolling message list, a WorkspaceBar (project + model) above the composer,
// and the composer/InputBar itself. It conforms to the SurfaceProps contract
// (see src/workspace/router.ts) and is the default tab the shell boots on.
//
// Migrated from the legacy src/tabs/chat.tsx: same SSE streaming via
// src/core/chatStream.ts, agent picker (Ctrl+A), and slash commands
// (/btw /goal /proof /check /model /team /sessions /queue /theme /help /new
// /newchat). /goal, /proof
// and /check are Core server-side plugin turn-hooks: /goal and /proof pass through
// as normal messages, /check arms the double-check hook via plugin_flags and its
// output arrives as data-plugin_note frames. Keyboard is OWNED here
// and gated on being the active tab of the FOCUSED pane, so a split with two chat
// panes only routes keys to the focused one.

import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { fetchAcpConfig } from "@ryuhq/core-client/acp";
import { fetchAgents } from "@ryuhq/core-client/agents";
import { askBtw } from "@ryuhq/core-client/btw";
import {
	listSessionsForConversation,
	type Session,
} from "@ryuhq/core-client/sessions";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Markdown } from "@/components/ui/markdown.tsx";
import { StatusMessage } from "@/components/ui/status-message.tsx";
import { useTheme } from "@/components/ui/theme-provider.tsx";
import { ChatQueueBar } from "../../components/ChatQueueBar.tsx";
import { ChatQueueOverlay } from "../../components/ChatQueueOverlay.tsx";
import { TranscriptParts } from "../../components/TranscriptParts.tsx";
import {
	type AcpPickerChoice,
	acpPickerChoices,
	applyAcpPickerChoice,
} from "../../core/acpPicker.ts";
import {
	type AutocompleteState,
	agentSuggestions,
	applyAutocomplete,
	commandSuggestions,
	getAutocompleteContext,
	moveAutocompleteIndex,
} from "../../core/autocomplete.ts";
import { useChatIntent } from "../../core/ChatIntentContext.tsx";
import { useCore } from "../../core/CoreContext.tsx";
import {
	type ChatPermission,
	parseChatPermission,
	permissionToolTitle,
	respondToChatPermission,
} from "../../core/chatPermission.ts";
import {
	type ChatQuestion,
	type ChatQuestionAnswer,
	parseChatQuestion,
	respondToChatQuestion,
} from "../../core/chatQuestion.ts";
import {
	clearChatQueue,
	dequeueChatTurn,
	enqueueChatTurn,
	moveQueuedChatTurn,
	type QueuedChatTurn,
	removeQueuedChatTurn,
} from "../../core/chatQueue.ts";
import {
	type ChatStreamOptions,
	type ChatTurn,
	streamChat,
} from "../../core/chatStream.ts";
import {
	appendReasoningPart,
	appendTextPart,
	appendToolInputPart,
	appendToolOutputPart,
	type ChatPart,
	readTodos,
	replaceTodoPart,
} from "../../core/chatTranscript.ts";
import {
	type CommandAction,
	commandHelpRows,
	dispatchCommand,
	renderCommandHelp,
} from "../../core/commands.ts";
import {
	deleteConversation,
	forkConversation,
	renameConversation,
	resumeConversation,
	setConversationPinned,
} from "../../core/conversations.ts";
import { useSetInputFocused } from "../../core/InputFocusContext.tsx";
import { keymapGroups } from "../../core/keymap.ts";
import {
	acpModelPickerChoices,
	agentModelPickerChoices,
	type ModelPickerChoice,
	withDefaultModelChoice,
} from "../../core/modelPicker.ts";
import {
	loadPromptHistory,
	nextPrompt,
	previousPrompt,
	recordPrompt,
	resetPromptNavigation,
	savePromptHistory,
} from "../../core/promptHistory.ts";
import { RYU_THEME_PRESETS } from "../../core/themePreferences.ts";
import { useTerminalTheme } from "../../ui/TerminalThemeProvider.tsx";
import { useToast } from "../../ui/toast.tsx";
import type { SurfaceModule, SurfaceProps } from "../../workspace/router.ts";
import { useWorkspace } from "../../workspace/WorkspaceContext.tsx";

type Role = "user" | "assistant";

interface Message {
	content: string;
	id: number;
	parts: ChatPart[];
	role: Role;
}

type Overlay =
	| { kind: "none" }
	| { kind: "agents"; agents: { id: string; name: string }[]; index: number }
	| { kind: "models"; choices: ModelPickerChoice[]; index: number }
	| { kind: "acp"; choices: AcpPickerChoice[]; index: number }
	| { kind: "sessions"; sessions: Session[] }
	| { kind: "btw"; question: string; answer: string | null }
	| { kind: "permission"; permission: ChatPermission; index: number }
	| {
			kind: "question";
			question: ChatQuestion;
			questionIndex: number;
			selected: number;
			answers: ChatQuestionAnswer[];
			text: string;
	  }
	| { kind: "delete"; conversationId: string }
	| { kind: "help"; command?: string }
	| { kind: "queue"; index: number }
	| { kind: "theme"; argument?: string }
	| { kind: "keymap" }
	| { kind: "plugin_note"; notes: string[] };

let nextMessageId = 1;

function ChatSurface({ active, paneId }: SurfaceProps) {
	const { target } = useCore();
	const theme = useTheme();
	const {
		availableModes,
		availablePresets,
		preference: themePreference,
		reset: resetTheme,
		setMode: setThemeMode,
		setPreset: setThemePreset,
	} = useTerminalTheme();
	const { notify } = useToast();
	const { focusedPaneId } = useWorkspace();
	const setInputFocused = useSetInputFocused();
	const { pending: chatIntent, clear: clearChatIntent } = useChatIntent();

	// Focused = this surface is the active tab AND its pane owns the keyboard.
	const focused = active && focusedPaneId === paneId;

	const [messages, setMessages] = useState<Message[]>([]);
	const [composer, setComposer] = useState("");
	const [promptHistory, setPromptHistory] = useState(loadPromptHistory);
	const [streaming, setStreaming] = useState(false);
	const [queuedMessages, setQueuedMessages] = useState<QueuedChatTurn[]>([]);
	const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
	const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
	const [acpModel, setAcpModel] = useState<string | null>(null);
	const [acpMode, setAcpMode] = useState<string | null>(null);
	const [acpConfig, setAcpConfig] = useState<Record<string, string>>({});
	const [doubleCheckOn, setDoubleCheckOn] = useState(false);
	const [overlay, setOverlay] = useState<Overlay>({ kind: "none" });
	const [queueFocused, setQueueFocused] = useState(false);
	const [queueSelectedIndex, setQueueSelectedIndex] = useState(0);
	const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(
		null
	);

	const conversationIdRef = useRef<string>(crypto.randomUUID());
	const abortRef = useRef<AbortController | null>(null);
	const composerRef = useRef(composer);
	composerRef.current = composer;
	const messagesRef = useRef(messages);
	messagesRef.current = messages;

	const overlayOpen = overlay.kind !== "none";

	useEffect(() => {
		if (queuedMessages.length === 0) {
			setQueueSelectedIndex(0);
			setQueueFocused(false);
			if (overlay.kind === "queue") {
				setOverlay({ kind: "none" });
			}
			return;
		}
		setQueueSelectedIndex((index) =>
			Math.min(index, Math.max(0, queuedMessages.length - 1))
		);
	}, [overlay.kind, queuedMessages.length]);

	// Slash commands are local and immediate. Mention candidates come from the
	// same Core agent catalog as Ctrl+A, but stale responses never replace newer
	// input.
	useEffect(() => {
		const context = getAutocompleteContext(composer);
		if (!context) {
			setAutocomplete(null);
			return;
		}
		if (context.kind === "slash") {
			const suggestions = commandSuggestions(context.query);
			setAutocomplete({ context, suggestions, index: 0 });
			return;
		}
		setAutocomplete({ context, suggestions: [], index: 0 });
		fetchAgents(target)
			.then((agents) => {
				if (composerRef.current !== composer) {
					return;
				}
				const latest = getAutocompleteContext(composer);
				if (latest?.kind !== "mention") {
					return;
				}
				setAutocomplete({
					context: latest,
					suggestions: agentSuggestions(agents, latest.query),
					index: 0,
				});
			})
			.catch(() => {
				if (composerRef.current === composer) {
					setAutocomplete(null);
				}
			});
	}, [composer, target]);

	// Claim raw input while focused so shell plain-key globals stay quiet.
	useEffect(() => {
		setInputFocused(focused && !overlayOpen && !queueFocused);
		return () => setInputFocused(false);
	}, [focused, overlayOpen, queueFocused, setInputFocused]);

	const resetChat = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		conversationIdRef.current = crypto.randomUUID();
		setMessages([]);
		setComposer("");
		setPromptHistory((state) => resetPromptNavigation(state));
		setQueuedMessages([]);
		setStreaming(false);
		setOverlay({ kind: "none" });
		setAutocomplete(null);
		notify("Started a new chat", "info");
	}, [notify]);

	const buildOptions = useCallback((): ChatStreamOptions => {
		const conversationId = conversationIdRef.current;
		// Arm Core's double-check turn-hook for this turn when the toggle is on.
		const pluginFlags = doubleCheckOn
			? { "io.ryu.double-check": true }
			: undefined;
		if (selectedTeam) {
			return {
				conversationId,
				teamId: selectedTeam,
				acpModel: acpModel ?? undefined,
				acpMode: acpMode ?? undefined,
				acpConfig,
				pluginFlags,
			};
		}
		return {
			conversationId,
			agentId: selectedAgent ?? undefined,
			acpModel: acpModel ?? undefined,
			acpMode: acpMode ?? undefined,
			acpConfig,
			pluginFlags,
		};
	}, [
		selectedTeam,
		selectedAgent,
		acpModel,
		acpMode,
		acpConfig,
		doubleCheckOn,
	]);

	const updateLastAssistant = useCallback(
		(update: (message: Message) => Message) => {
			setMessages((prev) => {
				const last = prev.at(-1);
				if (last?.role !== "assistant") {
					return prev;
				}
				return [...prev.slice(0, -1), update(last)];
			});
		},
		[]
	);
	const appendToLast = useCallback(
		(delta: string) =>
			updateLastAssistant((message) => ({
				...message,
				content: message.content + delta,
				parts: appendTextPart(message.parts, delta),
			})),
		[updateLastAssistant]
	);

	// Append a plugin note (goal/proof/double-check hook output) into the note
	// overlay, accumulating across the several notes a single turn can emit.
	const pushPluginNote = useCallback((text: string) => {
		setOverlay((o) =>
			o.kind === "plugin_note"
				? { kind: "plugin_note", notes: [...o.notes, text] }
				: { kind: "plugin_note", notes: [text] }
		);
	}, []);

	const send = useCallback(
		(text: string, optionsOverride?: ChatStreamOptions) => {
			const trimmed = text.trim();
			if (trimmed.length === 0) {
				return;
			}
			const priorTurns: ChatTurn[] = messagesRef.current.map((m) => ({
				role: m.role,
				content: m.content,
			}));
			const turns: ChatTurn[] = [
				...priorTurns,
				{ role: "user", content: trimmed },
			];

			setMessages((prev) => [
				...prev,
				{
					id: nextMessageId++,
					role: "user",
					content: trimmed,
					parts: [{ type: "text", text: trimmed }],
				},
				{ id: nextMessageId++, role: "assistant", content: "", parts: [] },
			]);
			setStreaming(true);

			const controller = new AbortController();
			abortRef.current = controller;

			streamChat(
				target,
				turns,
				optionsOverride ?? buildOptions(),
				{
					onTextDelta: appendToLast,
					onToolInput: (name, input, toolCallId) => {
						updateLastAssistant((message) => ({
							...message,
							parts: appendToolInputPart(
								message.parts,
								name,
								input && typeof input === "object" && !Array.isArray(input)
									? (input as Record<string, unknown>)
									: undefined,
								toolCallId
							),
						}));
						const question =
							name === "Question" ? parseChatQuestion(input) : null;
						if (question) {
							setOverlay({
								kind: "question",
								question,
								questionIndex: 0,
								selected: 0,
								answers: [],
								text: "",
							});
						}
					},
					onToolOutput: (status, output, toolCallId) =>
						updateLastAssistant((message) => ({
							...message,
							parts: appendToolOutputPart(
								message.parts,
								status,
								output,
								toolCallId
							),
						})),
					onReasoningDelta: (delta) =>
						updateLastAssistant((message) => ({
							...message,
							parts: appendReasoningPart(message.parts, delta),
						})),
					onTodo: (input) =>
						updateLastAssistant((message) => ({
							...message,
							parts: replaceTodoPart(message.parts, readTodos(input)),
						})),
					onPluginNote: pushPluginNote,
					onPermission: (value) => {
						const permission = parseChatPermission(value);
						if (permission) {
							setOverlay({ kind: "permission", index: 0, permission });
						}
					},
					onError: (message) => {
						appendToLast(`\n[error: ${message}]`);
						notify(message, "error");
					},
					onDone: () => {
						/* finalize handled after the promise resolves */
					},
				},
				controller.signal
			)
				.then(() => {
					setStreaming(false);
					abortRef.current = null;
				})
				.catch((err: unknown) => {
					setStreaming(false);
					abortRef.current = null;
					notify(errText(err), "error");
				});
		},
		[
			target,
			buildOptions,
			appendToLast,
			updateLastAssistant,
			pushPluginNote,
			notify,
		]
	);

	// Keep Core single-flight: once a turn settles, submit the oldest queued
	// prompt. The effect also handles a queue populated by rapid key presses.
	useEffect(() => {
		if (streaming || queuedMessages.length === 0) {
			return;
		}
		const { turn, queue } = dequeueChatTurn(queuedMessages);
		if (turn === null) {
			return;
		}
		setQueuedMessages(queue);
		send(turn.text, turn.options);
	}, [queuedMessages, send, streaming]);

	const openAgentPicker = useCallback(() => {
		fetchAgents(target)
			.then((agents) =>
				setOverlay({
					kind: "agents",
					agents: agents.map((a) => ({ id: a.id, name: a.name })),
					index: 0,
				})
			)
			.catch((err: unknown) =>
				notify(`agents failed: ${errText(err)}`, "error")
			);
	}, [target, notify]);

	const openAcpPicker = useCallback(() => {
		if (!selectedAgent || selectedTeam) {
			notify("Choose an agent before opening ACP settings", "warning");
			return;
		}
		fetchAcpConfig(target, selectedAgent)
			.then((config) => {
				const choices = acpPickerChoices(config);
				if (choices.length === 0) {
					notify(
						"This agent exposes no permission or reasoning settings",
						"info"
					);
					return;
				}
				setOverlay({ kind: "acp", choices, index: 0 });
			})
			.catch((err: unknown) =>
				notify(`ACP settings failed: ${errText(err)}`, "error")
			);
	}, [selectedAgent, selectedTeam, target, notify]);

	const openModelPicker = useCallback(() => {
		fetchAgents(target)
			.then(async (agents) => {
				let choices: ModelPickerChoice[] = [];
				if (selectedAgent && !selectedTeam) {
					try {
						choices = acpModelPickerChoices(
							await fetchAcpConfig(target, selectedAgent)
						);
					} catch {
						// Fall back to the model already configured on the agent.
						choices = [];
					}
				}
				if (choices.length === 0) {
					choices = agentModelPickerChoices(agents, selectedAgent);
				}
				if (choices.length === 0) {
					notify("No models are available for the current agent", "info");
					return;
				}
				setOverlay({
					kind: "models",
					choices: withDefaultModelChoice(choices),
					index: 0,
				});
			})
			.catch((err: unknown) =>
				notify(`models failed: ${errText(err)}`, "error")
			);
	}, [selectedAgent, selectedTeam, target, notify]);

	const runBtw = useCallback(
		(arg: string) => {
			if (arg.length === 0) {
				notify("usage: /btw <question>", "warning");
				return;
			}
			setOverlay({ kind: "btw", question: arg, answer: null });
			askBtw(target, conversationIdRef.current, arg)
				.then((res) =>
					setOverlay({ kind: "btw", question: arg, answer: res.answer })
				)
				.catch((err: unknown) => {
					setOverlay({ kind: "none" });
					notify(`btw failed: ${errText(err)}`, "error");
				});
		},
		[target, notify]
	);

	const runTeam = useCallback(
		(arg: string) => {
			if (arg.length === 0 || arg === "clear") {
				setSelectedTeam(null);
				notify("Team routing cleared", "info");
				return;
			}
			setSelectedTeam(arg);
			setSelectedAgent(null);
			notify(`Team: ${arg}`, "info");
		},
		[notify]
	);

	const runSessions = useCallback(() => {
		listSessionsForConversation(target, conversationIdRef.current)
			.then((sessions) => setOverlay({ kind: "sessions", sessions }))
			.catch((err: unknown) =>
				notify(`sessions failed: ${errText(err)}`, "error")
			);
	}, [target, notify]);

	const runFork = useCallback(
		(messageId: string) => {
			if (streaming) {
				notify("Wait for the current turn to finish before forking", "warning");
				return;
			}
			forkConversation(
				target,
				conversationIdRef.current,
				messageId.length > 0 ? messageId : undefined
			)
				.then((newConversationId) => {
					conversationIdRef.current = newConversationId;
					setMessages([]);
					setQueuedMessages([]);
					notify(`Forked chat: ${newConversationId}`, "info");
				})
				.catch((err: unknown) =>
					notify(`fork failed: ${errText(err)}`, "error")
				);
		},
		[target, notify, streaming]
	);

	const runPin = useCallback(
		(pinned: boolean) => {
			setConversationPinned(target, conversationIdRef.current, pinned)
				.then(() => notify(pinned ? "Chat pinned" : "Chat unpinned", "info"))
				.catch((err: unknown) =>
					notify(`${pinned ? "pin" : "unpin"} failed: ${errText(err)}`, "error")
				);
		},
		[target, notify]
	);

	const runResume = useCallback(
		(conversationId: string) => {
			if (conversationId.length === 0) {
				notify("usage: /resume <conversation-id>", "warning");
				return;
			}
			if (streaming) {
				notify(
					"Wait for the current turn to finish before resuming",
					"warning"
				);
				return;
			}
			resumeConversation(target, conversationId)
				.then((conversation) => {
					conversationIdRef.current = conversation.id;
					setMessages(
						conversation.messages.map((message) => ({
							id: nextMessageId++,
							role: message.role === "user" ? "user" : "assistant",
							content: message.content,
							parts:
								Array.isArray(message.parts) && message.parts.length > 0
									? (message.parts as ChatPart[])
									: [{ type: "text", text: message.content }],
						}))
					);
					setQueuedMessages([]);
					setOverlay({ kind: "none" });
					notify(
						conversation.title
							? `Resumed: ${conversation.title}`
							: `Resumed chat: ${conversation.id}`,
						"info"
					);
				})
				.catch((err: unknown) =>
					notify(`resume failed: ${errText(err)}`, "error")
				);
		},
		[target, notify, streaming]
	);

	const runRename = useCallback(
		(title: string) => {
			if (title.length === 0) {
				notify("usage: /rename <title>", "warning");
				return;
			}
			renameConversation(target, conversationIdRef.current, title)
				.then((nextTitle) => notify(`Renamed: ${nextTitle}`, "info"))
				.catch((err: unknown) =>
					notify(`rename failed: ${errText(err)}`, "error")
				);
		},
		[target, notify]
	);

	const runDelete = useCallback((conversationId: string) => {
		const id = conversationId || conversationIdRef.current;
		setOverlay({ kind: "delete", conversationId: id });
	}, []);

	const toggleDoubleCheck = useCallback(() => {
		setDoubleCheckOn((on) => {
			notify(on ? "Double-check off" : "Double-check armed", "info");
			return !on;
		});
	}, [notify]);

	const clearQueuedMessages = useCallback(() => {
		if (queuedMessages.length === 0) {
			return;
		}
		setQueuedMessages(clearChatQueue(queuedMessages));
		setOverlay({ kind: "none" });
		setQueueFocused(false);
		notify("Queue cleared", "info");
	}, [notify, queuedMessages]);

	const removeQueuedMessageAt = useCallback(
		(index: number) => {
			const turn = queuedMessages[index];
			if (!turn) {
				return;
			}
			setQueuedMessages(removeQueuedChatTurn(queuedMessages, turn.id));
			notify("Removed queued prompt", "info");
		},
		[notify, queuedMessages]
	);

	const moveQueuedMessage = useCallback(
		(id: string, direction: "up" | "down") => {
			setQueuedMessages((current) =>
				moveQueuedChatTurn(current, id, direction)
			);
		},
		[]
	);

	const moveQueuedMessageAt = useCallback(
		(index: number, direction: "up" | "down") => {
			const turn = queuedMessages[index];
			if (!turn) {
				return;
			}
			const nextIndex =
				direction === "up"
					? Math.max(0, index - 1)
					: Math.min(queuedMessages.length - 1, index + 1);
			if (nextIndex === index) {
				return;
			}
			setQueuedMessages((current) =>
				moveQueuedChatTurn(current, turn.id, direction)
			);
			setQueueSelectedIndex(nextIndex);
		},
		[queuedMessages]
	);

	const openQueue = useCallback(
		(index = queueSelectedIndex) => {
			if (queuedMessages.length === 0) {
				notify("The prompt queue is empty", "info");
				return;
			}
			const nextIndex = Math.min(
				Math.max(0, index),
				Math.max(0, queuedMessages.length - 1)
			);
			setQueueSelectedIndex(nextIndex);
			setQueueFocused(false);
			setOverlay({ kind: "queue", index: nextIndex });
		},
		[notify, queueSelectedIndex, queuedMessages.length]
	);

	const openTheme = useCallback(
		(argument = "") => setOverlay({ kind: "theme", argument }),
		[]
	);

	const applyThemeArgument = useCallback(
		(argument: string): boolean => {
			const normalized = argument.trim().toLowerCase();
			if (normalized.length === 0) {
				return false;
			}
			if (availableModes.some((mode) => mode === normalized)) {
				setThemeMode(normalized as "system" | "light" | "dark");
				notify(`Theme mode: ${normalized}`, "info");
				return true;
			}
			const preset = availablePresets.find(
				(candidate) => candidate === normalized
			);
			if (preset) {
				setThemePreset(preset);
				notify(`Theme preset: ${RYU_THEME_PRESETS[preset].label}`, "info");
				return true;
			}
			return false;
		},
		[availableModes, availablePresets, notify, setThemeMode, setThemePreset]
	);

	const applyCommandAction = useCallback(
		(action: CommandAction): boolean => {
			if (action.kind === "passthrough") {
				return false;
			}
			if (action.kind === "overlay") {
				switch (action.overlay) {
					case "agent-picker":
						openAgentPicker();
						return true;
					case "acp-settings":
						openAcpPicker();
						return true;
					case "btw":
						runBtw(action.argument);
						return true;
					case "conversation-delete":
						runDelete(action.argument);
						return true;
					case "help":
						setOverlay({
							kind: "help",
							command: action.argument || undefined,
						});
						return true;
					case "model-picker":
						openModelPicker();
						return true;
					case "queue":
						openQueue();
						return true;
					case "session-list":
						runSessions();
						return true;
					case "theme":
						if (!applyThemeArgument(action.argument)) {
							openTheme(action.argument);
						}
						return true;
				}
			}
			if (action.kind !== "local") {
				return true;
			}
			switch (action.action) {
				case "new-chat":
					resetChat();
					return true;
				case "toggle-double-check":
					toggleDoubleCheck();
					return true;
				case "set-model":
					setAcpModel(action.model);
					notify(
						action.model ? `Model: ${action.model}` : "Model override cleared",
						"info"
					);
					return true;
				case "set-team":
					runTeam(action.team ?? "");
					return true;
				case "fork-conversation":
					runFork(action.messageId ?? "");
					return true;
				case "resume-conversation":
					runResume(action.conversationId);
					return true;
				case "rename-conversation":
					runRename(action.title);
					return true;
				case "pin-conversation":
					runPin(action.pinned);
					return true;
				case "clear-queue":
					clearQueuedMessages();
					return true;
				case "remove-queue-item": {
					const index = queuedMessages.findIndex(
						(turn) => turn.id === action.itemId
					);
					if (index >= 0) {
						removeQueuedMessageAt(index);
					}
					return true;
				}
				case "move-queue-item":
					moveQueuedMessage(action.itemId, action.direction);
					return true;
			}
		},
		[
			applyThemeArgument,
			clearQueuedMessages,
			moveQueuedMessage,
			notify,
			openAcpPicker,
			openAgentPicker,
			openModelPicker,
			openQueue,
			openTheme,
			queuedMessages,
			removeQueuedMessageAt,
			resetChat,
			runBtw,
			runDelete,
			runFork,
			runPin,
			runRename,
			runResume,
			runSessions,
			runTeam,
			setThemeMode,
			toggleDoubleCheck,
		]
	);

	const handleCommand = useCallback(
		(raw: string): boolean => {
			const dispatch = dispatchCommand(raw);
			if (!dispatch) {
				return false;
			}
			if (dispatch.kind === "unknown" || dispatch.kind === "usage") {
				notify(dispatch.message, "warning");
				return true;
			}
			return applyCommandAction(dispatch.action);
		},
		[applyCommandAction, notify]
	);

	const submitComposer = useCallback(() => {
		const text = composer;
		setComposer("");
		setAutocomplete(null);
		setPromptHistory((state) => {
			const next = recordPrompt(state, text);
			savePromptHistory(next.entries);
			return next;
		});
		if (handleCommand(text)) {
			return;
		}
		if (streaming) {
			const result = enqueueChatTurn(queuedMessages, text, buildOptions());
			if (result.accepted) {
				setQueuedMessages(result.queue);
				notify(`Queued prompt (${result.queue.length})`, "info");
			} else {
				notify(
					"Prompt queue is full (50); wait for the current turn",
					"warning"
				);
			}
			return;
		}
		send(text);
	}, [
		composer,
		handleCommand,
		queuedMessages,
		streaming,
		send,
		notify,
		buildOptions,
	]);

	const applySelectedAutocomplete = useCallback(() => {
		if (!autocomplete) {
			return false;
		}
		const suggestion = autocomplete.suggestions[autocomplete.index];
		if (!suggestion) {
			return false;
		}
		setComposer(applyAutocomplete(composer, autocomplete.context, suggestion));
		setAutocomplete(null);
		return true;
	}, [autocomplete, composer]);

	// Apply a palette-issued chat intent once this surface is the active tab.
	useEffect(() => {
		if (!(active && chatIntent)) {
			return;
		}
		if (chatIntent === "new") {
			resetChat();
		} else if (chatIntent === "sessions") {
			runSessions();
		} else if (chatIntent === "toggle-check") {
			toggleDoubleCheck();
		}
		clearChatIntent();
	}, [
		active,
		chatIntent,
		clearChatIntent,
		resetChat,
		runSessions,
		toggleDoubleCheck,
	]);

	const handleAgentKey = (key: KeyEvent) => {
		if (overlay.kind !== "agents") {
			return;
		}
		if (key.name === "escape") {
			setOverlay({ kind: "none" });
		} else if (key.name === "up" || key.name === "k") {
			setOverlay((o) =>
				o.kind === "agents" ? { ...o, index: Math.max(0, o.index - 1) } : o
			);
		} else if (key.name === "down" || key.name === "j") {
			setOverlay((o) =>
				o.kind === "agents"
					? { ...o, index: Math.min(o.agents.length - 1, o.index + 1) }
					: o
			);
		} else if (key.name === "return") {
			const chosen = overlay.agents[overlay.index];
			if (chosen) {
				setSelectedAgent(chosen.id);
				setSelectedTeam(null);
				notify(`Agent: ${chosen.name}`, "info");
			}
			setOverlay({ kind: "none" });
		}
	};

	const handleModelKey = (key: KeyEvent) => {
		if (overlay.kind !== "models") {
			return;
		}
		if (key.name === "escape") {
			setOverlay({ kind: "none" });
		} else if (key.name === "up" || key.name === "k") {
			setOverlay((o) =>
				o.kind === "models" ? { ...o, index: Math.max(0, o.index - 1) } : o
			);
		} else if (key.name === "down" || key.name === "j") {
			setOverlay((o) =>
				o.kind === "models"
					? { ...o, index: Math.min(o.choices.length - 1, o.index + 1) }
					: o
			);
		} else if (key.name === "return") {
			const choice = overlay.choices[overlay.index];
			if (choice) {
				setAcpModel(choice.id);
				notify(
					choice.id ? `Model: ${choice.label}` : "Model override cleared",
					"info"
				);
			}
			setOverlay({ kind: "none" });
		}
	};

	const handleAcpKey = (key: KeyEvent) => {
		if (overlay.kind !== "acp") {
			return;
		}
		if (key.name === "escape") {
			setOverlay({ kind: "none" });
		} else if (key.name === "up" || key.name === "k") {
			setOverlay((o) =>
				o.kind === "acp" ? { ...o, index: Math.max(0, o.index - 1) } : o
			);
		} else if (key.name === "down" || key.name === "j") {
			setOverlay((o) =>
				o.kind === "acp"
					? { ...o, index: Math.min(o.choices.length - 1, o.index + 1) }
					: o
			);
		} else if (key.name === "return") {
			const choice = overlay.choices[overlay.index];
			if (choice) {
				const next = applyAcpPickerChoice(choice, {
					mode: acpMode,
					config: acpConfig,
				});
				setAcpMode(next.mode);
				setAcpConfig(next.config);
				notify(`ACP: ${choice.label}`, "info");
			}
			setOverlay({ kind: "none" });
		}
	};

	const handlePermissionKey = (key: KeyEvent) => {
		if (overlay.kind !== "permission") {
			return;
		}
		if (key.name === "escape") {
			const requestId = overlay.permission.requestId;
			setOverlay({ kind: "none" });
			respondToChatPermission(target, requestId, null).catch((err: unknown) =>
				notify(`permission rejected: ${errText(err)}`, "error")
			);
			return;
		}
		if (key.name === "up" || key.name === "k") {
			setOverlay((o) =>
				o.kind === "permission" ? { ...o, index: Math.max(0, o.index - 1) } : o
			);
			return;
		}
		if (key.name === "down" || key.name === "j") {
			setOverlay((o) =>
				o.kind === "permission"
					? {
							...o,
							index: Math.min(o.permission.options.length - 1, o.index + 1),
						}
					: o
			);
			return;
		}
		if (key.name === "return") {
			const option = overlay.permission.options[overlay.index];
			if (!option) {
				return;
			}
			const requestId = overlay.permission.requestId;
			setOverlay({ kind: "none" });
			respondToChatPermission(target, requestId, option.optionId).catch(
				(err: unknown) => notify(`permission failed: ${errText(err)}`, "error")
			);
		}
	};

	const handleQuestionKey = (key: KeyEvent) => {
		if (overlay.kind !== "question") {
			return;
		}
		const current = overlay.question.questions[overlay.questionIndex];
		if (!current) {
			return;
		}
		if (key.name === "escape") {
			setOverlay({ kind: "none" });
			void respondToChatQuestion(
				target,
				conversationIdRef.current,
				overlay.question,
				[{ kind: "skip", question_id: current.id }]
			).catch((err: unknown) =>
				notify(`question rejected: ${errText(err)}`, "error")
			);
			return;
		}
		if (current.kind === "text") {
			if (key.name === "backspace") {
				setOverlay((state) =>
					state.kind === "question"
						? { ...state, text: state.text.slice(0, -1) }
						: state
				);
				return;
			}
			if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
				setOverlay((state) =>
					state.kind === "question"
						? { ...state, text: state.text + key.sequence }
						: state
				);
				return;
			}
		}
		if (key.name === "up" || key.name === "k") {
			setOverlay((state) =>
				state.kind === "question"
					? { ...state, selected: Math.max(0, state.selected - 1) }
					: state
			);
			return;
		}
		if (key.name === "down" || key.name === "j") {
			setOverlay((state) =>
				state.kind === "question"
					? {
							...state,
							selected: Math.min(
								Math.max(0, current.options.length - 1),
								state.selected + 1
							),
						}
					: state
			);
			return;
		}
		if (key.name !== "return") {
			return;
		}
		const selected = current.options[overlay.selected];
		const answer: ChatQuestionAnswer =
			current.kind === "text"
				? { kind: "text", question_id: current.id, text: overlay.text }
				: {
						kind: current.kind,
						question_id: current.id,
						selected_ids: selected ? [selected.id] : [],
					};
		const answers = [...overlay.answers, answer];
		const nextIndex = overlay.questionIndex + 1;
		if (nextIndex < overlay.question.questions.length) {
			setOverlay({
				...overlay,
				answers,
				questionIndex: nextIndex,
				selected: 0,
				text: "",
			});
			return;
		}
		setOverlay({ kind: "none" });
		void respondToChatQuestion(
			target,
			conversationIdRef.current,
			overlay.question,
			answers
		)
			.then((resolved) => {
				if (!resolved) {
					notify("Question expired before it was answered", "warning");
				}
			})
			.catch((err: unknown) =>
				notify(`question failed: ${errText(err)}`, "error")
			);
	};

	const confirmDelete = useCallback(() => {
		if (overlay.kind !== "delete") {
			return;
		}
		const id = overlay.conversationId;
		setOverlay({ kind: "none" });
		void deleteConversation(target, id)
			.then((removed) => {
				if (id === conversationIdRef.current) {
					resetChat();
				}
				notify(
					removed ? "Conversation deleted" : "Conversation was already absent",
					"info"
				);
			})
			.catch((err: unknown) =>
				notify(`delete failed: ${errText(err)}`, "error")
			);
	}, [overlay, notify, resetChat, target]);

	const handleComposeKey = (key: KeyEvent) => {
		if (queueFocused) {
			return;
		}
		if (autocomplete) {
			if (key.name === "escape") {
				setAutocomplete(null);
				return;
			}
			if (key.name === "up" || key.name === "k") {
				setAutocomplete((state) =>
					state
						? {
								...state,
								index: moveAutocompleteIndex(
									state.index,
									-1,
									state.suggestions.length
								),
							}
						: null
				);
				return;
			}
			if (key.name === "down" || key.name === "j") {
				setAutocomplete((state) =>
					state
						? {
								...state,
								index: moveAutocompleteIndex(
									state.index,
									1,
									state.suggestions.length
								),
							}
						: null
				);
				return;
			}
			if (
				(key.name === "tab" || key.name === "return") &&
				applySelectedAutocomplete()
			) {
				return;
			}
		}
		if (key.ctrl && key.name === "q" && queuedMessages.length > 0) {
			setQueueFocused(true);
			setQueueSelectedIndex(0);
		} else if (key.ctrl && (key.name === "?" || key.name === "/")) {
			setOverlay({ kind: "keymap" });
		} else if (key.ctrl && key.name === "a") {
			openAgentPicker();
		} else if (key.ctrl && key.name === "r") {
			openAcpPicker();
		} else if (key.ctrl && key.name === "l") {
			resetChat();
		} else if (key.name === "return") {
			submitComposer();
		} else if (key.name === "up") {
			setPromptHistory((state) => {
				const next = previousPrompt(state, composer);
				setComposer(next.value);
				return next.state;
			});
		} else if (key.name === "down") {
			setPromptHistory((state) => {
				const next = nextPrompt(state, composer);
				setComposer(next.value);
				return next.state;
			});
		} else if (key.name === "escape" && streaming) {
			abortRef.current?.abort();
			setStreaming(false);
		}
	};

	// Keyboard gated on being the focused pane's active tab.
	useKeyboard((key) => {
		if (!focused) {
			return;
		}
		if (overlay.kind === "queue" || queueFocused) {
			return;
		}
		if (overlay.kind === "agents") {
			handleAgentKey(key);
			return;
		}
		if (overlay.kind === "models") {
			handleModelKey(key);
			return;
		}
		if (overlay.kind === "acp") {
			handleAcpKey(key);
			return;
		}
		if (overlay.kind === "permission") {
			handlePermissionKey(key);
			return;
		}
		if (overlay.kind === "question") {
			handleQuestionKey(key);
			return;
		}
		if (overlay.kind === "delete") {
			if (key.name === "escape" || key.name === "n") {
				setOverlay({ kind: "none" });
			} else if (key.name === "return" || key.name === "y") {
				void confirmDelete();
			}
			return;
		}
		if (overlay.kind === "keymap") {
			if (
				key.name === "escape" ||
				(key.ctrl && (key.name === "?" || key.name === "/"))
			) {
				setOverlay({ kind: "none" });
			}
			return;
		}
		if (overlay.kind === "help") {
			if (key.name === "escape" || key.name === "return") {
				setOverlay({ kind: "none" });
			}
			return;
		}
		if (overlay.kind === "theme") {
			return;
		}
		if (overlay.kind !== "none") {
			if (
				key.name === "escape" ||
				key.name === "return" ||
				key.name === "space"
			) {
				setOverlay({ kind: "none" });
			}
			return;
		}
		handleComposeKey(key);
	});

	const composerFocused = focused && !overlayOpen && !queueFocused;

	return (
		<box flexDirection="column" flexGrow={1}>
			<Transcript
				agent={selectedAgent}
				messages={messages}
				streaming={streaming}
				team={selectedTeam}
			/>
			<StatusLine
				agent={selectedAgent}
				doubleCheckOn={doubleCheckOn}
				model={acpModel}
				streaming={streaming}
				team={selectedTeam}
			/>
			{queuedMessages.length > 0 ? (
				<ChatQueueBar
					focused={queueFocused && !overlayOpen}
					items={queuedMessages}
					onCancel={() => setQueueFocused(false)}
					onClear={clearQueuedMessages}
					onFocus={() => openQueue(queueSelectedIndex)}
					onMove={moveQueuedMessageAt}
					onRemove={removeQueuedMessageAt}
					onSelect={(index) => setQueueSelectedIndex(index)}
					selectedIndex={queueSelectedIndex}
				/>
			) : null}
			<WorkspaceBar
				agent={selectedAgent}
				model={acpModel}
				team={selectedTeam}
			/>
			{autocomplete ? <AutocompleteView state={autocomplete} /> : null}
			<box
				borderColor={
					composerFocused ? theme.colors.focusRing : theme.colors.border
				}
				borderStyle="rounded"
				flexDirection="row"
				gap={1}
				paddingLeft={1}
				paddingRight={1}
			>
				<text fg={theme.colors.primary}>{"›"}</text>
				<input
					cursorColor={theme.colors.primary}
					focused={composerFocused}
					onChange={(value) => {
						setComposer(value);
						setPromptHistory(resetPromptNavigation);
					}}
					placeholder="Message, or /help /queue /theme /resume /rename /delete /sessions /fork /new (Ctrl+A agent, Ctrl+R ACP, Ctrl+Q queue)"
					placeholderColor={theme.colors.mutedForeground}
					textColor={theme.colors.foreground}
					value={composer}
				/>
			</box>
			{overlay.kind === "none" ? null : overlay.kind === "queue" ? (
				<ChatQueueOverlay
					focused
					items={queuedMessages}
					onCancel={() => setOverlay({ kind: "none" })}
					onClear={clearQueuedMessages}
					onMove={moveQueuedMessageAt}
					onRemove={removeQueuedMessageAt}
					onSelect={(index) => {
						setQueueSelectedIndex(index);
						setOverlay((state) =>
							state.kind === "queue" ? { ...state, index } : state
						);
					}}
					selectedIndex={queueSelectedIndex}
				/>
			) : (
				<OverlayView
					onClose={() => setOverlay({ kind: "none" })}
					overlay={overlay}
				/>
			)}
		</box>
	);
}

// Empty-state header shown before the first turn: the desktop AgentChat greeting
// with the current agent/team mode. Once messages exist it yields to the list.
function EmptyStateHeader({
	agent,
	team,
}: {
	agent: string | null;
	team: string | null;
}) {
	const theme = useTheme();
	let mode = "Ask anything";
	if (team) {
		mode = `Team: ${team}`;
	} else if (agent) {
		mode = `Agent: ${agent}`;
	}
	return (
		<box flexDirection="column" flexGrow={1} paddingLeft={1} paddingTop={1}>
			<text fg={theme.colors.primary}>
				<b>{mode}</b>
			</text>
			<text fg={theme.colors.mutedForeground}>
				Ctrl+A pick agent · Ctrl+Q queue · slash commands /help /queue /theme
				/btw /goal /proof /check /model /team /sessions /fork /new
			</text>
		</box>
	);
}

function Transcript({
	messages,
	streaming,
	agent,
	team,
}: {
	agent: string | null;
	messages: Message[];
	streaming: boolean;
	team: string | null;
}) {
	const theme = useTheme();
	if (messages.length === 0) {
		return <EmptyStateHeader agent={agent} team={team} />;
	}
	return (
		<scrollbox flexGrow={1} paddingLeft={1} paddingTop={1}>
			{messages.map((message, i) => {
				const isLast = i === messages.length - 1;
				const isStreamingAssistant =
					isLast && streaming && message.role === "assistant";
				return (
					<box flexDirection="column" key={message.id} marginBottom={1}>
						<text
							fg={
								message.role === "user"
									? theme.colors.primary
									: theme.colors.success
							}
						>
							<b>{message.role === "user" ? "you" : "assistant"}</b>
						</text>
						{message.parts.length > 0 ? (
							<TranscriptParts parts={message.parts} />
						) : (
							<text fg={theme.colors.mutedForeground}>
								{isStreamingAssistant ? "…" : ""}
							</text>
						)}
					</box>
				);
			})}
		</scrollbox>
	);
}

// WorkspaceBar - the desktop project-folder + model row that sits above the
// composer. The TUI has no folder picker yet, so it surfaces the routing target
// (agent/team) and the model selection as read-only chips (set via /model,
// /team, Ctrl+A) so the composer always shows what a turn will run against.
function WorkspaceBar({
	agent,
	team,
	model,
}: {
	agent: string | null;
	model: string | null;
	team: string | null;
}) {
	const theme = useTheme();
	const routeLabel = routeChip(agent, team);
	return (
		<box flexDirection="row" gap={2} paddingLeft={1}>
			<box flexDirection="row" gap={1}>
				<text fg={theme.colors.mutedForeground}>route</text>
				<text fg={theme.colors.foreground}>{routeLabel}</text>
			</box>
			<box flexDirection="row" gap={1}>
				<text fg={theme.colors.mutedForeground}>model</text>
				<text fg={theme.colors.foreground}>{model ?? "default"}</text>
			</box>
		</box>
	);
}

function StatusLine({
	agent,
	team,
	model,
	doubleCheckOn,
	streaming,
}: {
	agent: string | null;
	doubleCheckOn: boolean;
	model: string | null;
	streaming: boolean;
	team: string | null;
}) {
	const chips: { key: string; label: string }[] = [];
	if (team) {
		chips.push({ key: "team", label: `team:${team}` });
	} else if (agent) {
		chips.push({ key: "agent", label: `agent:${agent}` });
	}
	if (model) {
		chips.push({ key: "model", label: `model:${model}` });
	}
	if (doubleCheckOn) {
		chips.push({ key: "dc", label: "double-check" });
	}
	if (chips.length === 0 && !streaming) {
		return null;
	}
	return (
		<box flexDirection="row" gap={1} paddingLeft={1}>
			{streaming ? (
				<StatusMessage variant="loading">streaming</StatusMessage>
			) : null}
			{chips.map((chip) => (
				<Badge bordered={false} key={chip.key} variant="secondary">
					{chip.label}
				</Badge>
			))}
		</box>
	);
}

function AutocompleteView({ state }: { state: AutocompleteState }) {
	const theme = useTheme();
	if (state.suggestions.length === 0) {
		return null;
	}
	return (
		<box paddingLeft={1} paddingRight={1}>
			<Card
				subtitle="↑/↓ move · Tab/Enter choose · Esc cancel"
				title="Complete"
			>
				{state.suggestions.map((suggestion, index) => {
					const selected = index === state.index;
					return (
						<box
							flexDirection="row"
							gap={1}
							key={
								suggestion.kind === "command" ? suggestion.name : suggestion.id
							}
						>
							<text fg={selected ? theme.colors.primary : theme.colors.muted}>
								{selected ? "›" : " "}
							</text>
							<text
								fg={selected ? theme.colors.primary : theme.colors.foreground}
							>
								{suggestion.kind === "command"
									? `/${suggestion.name} — ${suggestion.description}`
									: `@${suggestion.id} — ${suggestion.name}`}
							</text>
						</box>
					);
				})}
			</Card>
		</box>
	);
}

function ThemePickerOverlay({
	argument,
	onClose,
}: {
	argument?: string;
	onClose: () => void;
}) {
	const theme = useTheme();
	const { notify } = useToast();
	const {
		availableModes,
		availablePresets,
		preference,
		reset,
		setMode,
		setPreset,
	} = useTerminalTheme();
	const options = [
		...availableModes.map((mode) => ({
			id: mode,
			kind: "mode" as const,
			label: mode === "system" ? "System (terminal)" : mode,
		})),
		...availablePresets.map((preset) => ({
			id: preset,
			kind: "preset" as const,
			label: RYU_THEME_PRESETS[preset].label,
		})),
	];
	const requested = argument?.trim().toLowerCase();
	const initialIndex = Math.max(
		0,
		options.findIndex(
			(option) =>
				option.id === requested ||
				(option.kind === "mode" && option.id === preference.mode) ||
				(option.kind === "preset" && option.id === preference.preset)
		)
	);
	const [index, setIndex] = useState(initialIndex);

	useKeyboard((key) => {
		if (key.name === "escape") {
			onClose();
			return;
		}
		if (key.name === "up" || key.name === "k") {
			setIndex((current) => Math.max(0, current - 1));
			return;
		}
		if (key.name === "down" || key.name === "j") {
			setIndex((current) => Math.min(options.length - 1, current + 1));
			return;
		}
		if (key.name === "r") {
			reset();
			notify("Terminal theme reset", "info");
			return;
		}
		if (key.name !== "return") {
			return;
		}
		const selected = options[index];
		if (!selected) {
			return;
		}
		if (selected.kind === "mode") {
			setMode(selected.id);
			notify(`Theme mode: ${selected.id}`, "info");
		} else {
			setPreset(selected.id);
			notify(`Theme preset: ${selected.label}`, "info");
		}
		onClose();
	});

	return (
		<box padding={1}>
			<Card
				subtitle="↑/↓ move · Enter apply · r reset · Esc cancel"
				title="Terminal theme"
			>
				{options.map((option, optionIndex) => {
					const selected = optionIndex === index;
					const active =
						(option.kind === "mode" && option.id === preference.mode) ||
						(option.kind === "preset" && option.id === preference.preset);
					return (
						<box
							backgroundColor={selected ? theme.colors.selection : undefined}
							flexDirection="row"
							gap={1}
							key={`${option.kind}-${option.id}`}
						>
							<text
								fg={
									selected
										? theme.colors.selectionForeground
										: theme.colors.primary
								}
							>
								{selected ? "›" : active ? "●" : " "}
							</text>
							<text
								fg={
									selected
										? theme.colors.selectionForeground
										: theme.colors.foreground
								}
							>
								{option.label}
							</text>
						</box>
					);
				})}
			</Card>
		</box>
	);
}

function OverlayView({
	onClose,
	overlay,
}: {
	onClose: () => void;
	overlay: Overlay;
}) {
	const theme = useTheme();
	if (overlay.kind === "agents") {
		return (
			<box padding={1}>
				<Card
					subtitle="↑/↓ move · Enter choose · Esc cancel"
					title="Select agent"
				>
					{overlay.agents.length === 0 ? (
						<text fg={theme.colors.mutedForeground}>No agents</text>
					) : (
						overlay.agents.map((agentItem, i) => (
							<box flexDirection="row" gap={1} key={agentItem.id}>
								<text
									fg={
										i === overlay.index
											? theme.colors.primary
											: theme.colors.muted
									}
								>
									{i === overlay.index ? "›" : " "}
								</text>
								<text
									fg={
										i === overlay.index
											? theme.colors.primary
											: theme.colors.foreground
									}
								>
									{agentItem.name}
								</text>
							</box>
						))
					)}
				</Card>
			</box>
		);
	}
	if (overlay.kind === "models") {
		return (
			<box padding={1}>
				<Card
					subtitle="↑/↓ move · Enter choose · Esc cancel"
					title="Select model"
				>
					{overlay.choices.map((choice, i) => (
						<box flexDirection="row" gap={1} key={choice.id ?? "default"}>
							<text
								fg={
									i === overlay.index
										? theme.colors.primary
										: theme.colors.muted
								}
							>
								{i === overlay.index ? "›" : " "}
							</text>
							<text
								fg={
									i === overlay.index
										? theme.colors.primary
										: theme.colors.foreground
								}
							>
								{choice.label}
							</text>
						</box>
					))}
				</Card>
			</box>
		);
	}
	if (overlay.kind === "sessions") {
		return (
			<box padding={1}>
				<Card subtitle="Esc to close" title="Sessions">
					{overlay.sessions.length === 0 ? (
						<text fg={theme.colors.mutedForeground}>No runs yet</text>
					) : (
						overlay.sessions.map((session) => (
							<box flexDirection="row" gap={1} key={session.id}>
								<text fg={theme.colors.foreground}>{session.runnableKind}</text>
								<text fg={theme.colors.mutedForeground}>
									{session.runnableId}
								</text>
								<Badge bordered={false} variant="secondary">
									{session.status}
								</Badge>
							</box>
						))
					)}
				</Card>
			</box>
		);
	}
	if (overlay.kind === "acp") {
		return (
			<box padding={1}>
				<Card
					subtitle="↑/↓ move · Enter choose · Esc cancel"
					title="ACP settings"
				>
					{overlay.choices.map((choice, i) => (
						<box
							flexDirection="row"
							gap={1}
							key={`${choice.kind}-${choice.id}-${i}`}
						>
							<text
								fg={
									i === overlay.index
										? theme.colors.primary
										: theme.colors.muted
								}
							>
								{i === overlay.index ? "›" : " "}
							</text>
							<text
								fg={
									i === overlay.index
										? theme.colors.primary
										: theme.colors.foreground
								}
							>
								{choice.label}
							</text>
						</box>
					))}
				</Card>
			</box>
		);
	}
	if (overlay.kind === "btw") {
		return (
			<box padding={1}>
				<Card subtitle={overlay.question} title="btw">
					{overlay.answer === null ? (
						<StatusMessage variant="loading">thinking…</StatusMessage>
					) : (
						<Markdown>{overlay.answer}</Markdown>
					)}
				</Card>
			</box>
		);
	}
	if (overlay.kind === "permission") {
		return (
			<box padding={1}>
				<Card
					subtitle="↑/↓ move · Enter choose · Esc reject"
					title="Permission required"
				>
					<text fg={theme.colors.mutedForeground}>
						{`Allow the agent to ${permissionToolTitle(overlay.permission.toolCall)}?`}
					</text>
					{overlay.permission.options.map((option, i) => (
						<box flexDirection="row" gap={1} key={option.optionId}>
							<text
								fg={
									i === overlay.index
										? theme.colors.primary
										: theme.colors.muted
								}
							>
								{i === overlay.index ? "›" : " "}
							</text>
							<text
								fg={
									i === overlay.index
										? theme.colors.primary
										: theme.colors.foreground
								}
							>
								{option.name}
							</text>
						</box>
					))}
				</Card>
			</box>
		);
	}
	if (overlay.kind === "question") {
		const current = overlay.question.questions[overlay.questionIndex];
		if (!current) {
			return null;
		}
		return (
			<box padding={1}>
				<Card subtitle="↑/↓ move · Enter submit · Esc skip" title="Question">
					<text fg={theme.colors.foreground}>{current.title}</text>
					{current.description ? (
						<text fg={theme.colors.mutedForeground}>{current.description}</text>
					) : null}
					{current.kind === "text" ? (
						<text fg={theme.colors.primary}>
							{overlay.text || "Type an answer…"}
						</text>
					) : (
						current.options.map((option, i) => (
							<box flexDirection="row" gap={1} key={option.id}>
								<text
									fg={
										i === overlay.selected
											? theme.colors.primary
											: theme.colors.muted
									}
								>
									{i === overlay.selected ? "›" : " "}
								</text>
								<text
									fg={
										i === overlay.selected
											? theme.colors.primary
											: theme.colors.foreground
									}
								>
									{option.label}
								</text>
							</box>
						))
					)}
				</Card>
			</box>
		);
	}
	if (overlay.kind === "delete") {
		return (
			<box padding={1}>
				<Card
					subtitle="Enter/Y confirm · Esc/N cancel"
					title="Delete conversation?"
				>
					<text fg={theme.colors.warning}>{overlay.conversationId}</text>
					<text fg={theme.colors.mutedForeground}>
						This permanently removes the conversation.
					</text>
				</Card>
			</box>
		);
	}
	if (overlay.kind === "help") {
		const command = overlay.command;
		const matchingRows = command
			? commandHelpRows().filter(
					(row) => row.name === command || row.aliases.includes(command)
				)
			: [];
		const lines =
			matchingRows.length > 0
				? matchingRows.map((row) => `${row.usage} — ${row.description}`)
				: renderCommandHelp().split("\n");
		return (
			<box padding={1}>
				<Card subtitle="Esc or Enter to close" title="Slash commands">
					{lines.map((line) => (
						<text fg={theme.colors.foreground} key={line}>
							{line}
						</text>
					))}
				</Card>
			</box>
		);
	}
	if (overlay.kind === "theme") {
		return <ThemePickerOverlay argument={overlay.argument} onClose={onClose} />;
	}
	if (overlay.kind === "keymap") {
		return (
			<box padding={1}>
				<Card subtitle="Ctrl+? or Esc to close" title="Keyboard shortcuts">
					{keymapGroups().map((group) => (
						<box flexDirection="column" key={group.group} marginBottom={1}>
							<text fg={theme.colors.primary}>{group.group}</text>
							{group.entries.map((entry) => (
								<box
									flexDirection="row"
									gap={2}
									key={`${entry.group}-${entry.keys}`}
								>
									<text fg={theme.colors.foreground}>{entry.keys}</text>
									<text fg={theme.colors.mutedForeground}>{entry.label}</text>
								</box>
							))}
						</box>
					))}
				</Card>
			</box>
		);
	}
	if (overlay.kind === "plugin_note") {
		return (
			<box padding={1}>
				<Card subtitle="from a plugin hook · Esc to close" title="Note">
					{overlay.notes.map((note, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: notes are append-only text with no stable id
						<Markdown key={i}>{note}</Markdown>
					))}
				</Card>
			</box>
		);
	}
	return null;
}

function routeChip(agent: string | null, team: string | null): string {
	if (team) {
		return `team:${team}`;
	}
	if (agent) {
		return `agent:${agent}`;
	}
	return "auto";
}

function errText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** The Chat surface module. Registered by src/workspace/router.ts as the home
 * surface (path /chat). */
export const chatSurface: SurfaceModule = {
	id: "chat",
	title: "Chat",
	icon: "",
	match: (path) => path === "/chat" || path.startsWith("/chat/"),
	Component: ChatSurface,
};
