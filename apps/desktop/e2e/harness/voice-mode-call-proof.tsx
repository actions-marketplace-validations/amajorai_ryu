import {
	InputBar,
	type InputBarProps,
} from "@ryu/blocks/desktop/agent-elements/input-bar.tsx";
import type { ChatVoiceMode } from "@ryu/blocks/desktop/agent-elements/types.ts";
import type { ChatStatus, UIMessage } from "ai";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentChat } from "../../components/agent-elements/agent-chat.tsx";
import { ChatDisplayPrefs } from "../../src/components/chat/ChatDisplayPrefsProvider.tsx";
import { VoiceModeSurface } from "../../src/components/voice/VoiceModeSurface.tsx";
import type { VoiceMode } from "../../src/hooks/useVoiceMode.ts";
import "../../src/index.css";

const LEVELS = [
	0.12, 0.24, 0.46, 0.32, 0.76, 0.58, 0.9, 0.42, 0.68, 0.3, 0.5, 0.22,
];

const TURNS: VoiceMode["turns"] = [
	{
		id: "u-1",
		role: "user",
		text: "Can you walk me through the next step?",
	},
	{
		id: "a-1",
		role: "assistant",
		text: "Absolutely. I will keep the next step focused and easy to follow.",
	},
];

function message(
	id: string,
	role: "assistant" | "user",
	text: string
): UIMessage {
	return {
		id,
		parts: [{ text, type: "text" }],
		role,
	} as unknown as UIMessage;
}

function ProofInputBar(props: InputBarProps) {
	return (
		<InputBar
			{...props}
			voice={{ transcribe: async () => "" }}
			voiceMode={{ onStart: () => undefined }}
		/>
	);
}

function Proof() {
	const [elapsedSeconds, setElapsedSeconds] = useState(84);
	const [messages, setMessages] = useState<UIMessage[]>([]);
	const [muted, setMuted] = useState(false);
	const [status, setStatus] = useState<ChatStatus>("ready");
	const [voiceActive, setVoiceActive] = useState(true);

	useEffect(() => {
		if (!voiceActive) {
			return;
		}
		const timer = window.setInterval(
			() => setElapsedSeconds((current) => current + 1),
			1000
		);
		return () => window.clearInterval(timer);
	}, [voiceActive]);

	const voice: VoiceMode = {
		agentName: "Ryu Assistant",
		active: true,
		caption: "",
		error: null,
		elapsedSeconds,
		interrupt: () => undefined,
		levels: muted ? new Array(24).fill(0) : LEVELS,
		muted,
		phase: "listening",
		start: () => undefined,
		stop: () => setVoiceActive(false),
		toggleMute: () => setMuted((current) => !current),
		transcript: "",
		turns: TURNS,
	};
	const voiceMode: ChatVoiceMode = voiceActive
		? {
				active: true,
				render: (composer: ReactNode) => (
					<VoiceModeSurface composer={composer} voice={voice} />
				),
			}
		: { active: false };
	const handleSend = useCallback((next: { content: string; role: "user" }) => {
		setMessages([message("proof-user", "user", next.content)]);
		setStatus("ready");
	}, []);

	return (
		<ChatDisplayPrefs>
			<div className="flex h-screen flex-col bg-background">
				<output className="sr-only" data-testid="voice-text-sent">
					{messages.at(-1)?.parts[0]?.type === "text"
						? messages.at(-1)?.parts[0]?.text
						: ""}
				</output>
				<AgentChat
					messages={messages}
					onSend={handleSend}
					onStop={() => setStatus("ready")}
					slots={{ InputBar: ProofInputBar }}
					status={status}
					voiceMode={voiceMode}
				/>
			</div>
		</ChatDisplayPrefs>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
		<Proof />
	</ThemeProvider>
);
