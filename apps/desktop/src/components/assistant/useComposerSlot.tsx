// The ONE full-composer slot shared by every non-ChatPage chat surface — the Ask
// Ryu floating/sidebar dock and the builder panes (agent · workflow · dashboard).
// It produces the SAME composer the main chat page renders: the Agent · Model ·
// Thinking settings menu (from `useComposerAgentControls` + `useComposerAcpSections`,
// the single source ChatPage/launchpad also use), STT voice input, the ChatGPT-style
// voice mode, image attachments (the "+"), and optional single-row compact layout
// / compact agent-picker trigger. Before this, each surface hand-rolled a lighter
// bar (or none), so the dock/builders silently lost the agent picker, thinking
// selector, voice, and attachments — the exact drift the user kept hitting
// ("still so different"). Route a surface through this and it can never drift
// from the chat page again.
//
// The slot identity must stay stable across renders or the textarea loses focus on
// every keystroke, so every injected prop rides a ref the memoized slot reads — the
// same pattern as ChatPage's `councilInputBar`.

import { handleComposerSettingsShortcut } from "@ryu/blocks/composer/composer-shortcuts";
import type { ReactNode } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useComposerAgentControls } from "@/components/agent-elements/input/composer-agent-controls.tsx";
import type { ComposerSettingsSection } from "@/components/agent-elements/input/composer-settings-menu.tsx";
import { useComposerAcpSections } from "@/components/agent-elements/input/use-composer-acp-sections.ts";
import {
	type AttachedImage,
	InputBar,
	type InputBarProps,
} from "@/components/agent-elements/input-bar.tsx";
import { VoiceModeSurface } from "@/src/components/voice/VoiceModeSurface.tsx";
import { useAgents } from "@/src/hooks/useAgents.ts";
import type { BuilderRuntime } from "@/src/hooks/useBuilderRuntime.ts";
import { useComposerShortcutBindings } from "@/src/hooks/useComposerShortcutBindings.ts";
import { useVoiceMode } from "@/src/hooks/useVoiceMode.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import { stageImageUpload } from "@/src/lib/api/uploads.ts";
import { transcribeAudio } from "@/src/lib/api/voice.ts";

/** An AI-SDK file part, ready for `sendMessage({ text, files })`. */
export interface ComposerSendFile {
	filename: string;
	mediaType: string;
	type: "file";
	url: string;
}

export interface ComposerSlot {
	/**
	 * Attach a Ryu Clip: stage its key-moment frames as image chips (they are
	 * images, so they ride the existing image path with zero blocks changes) and
	 * queue the clip's markdown context summary to be prepended to the next
	 * outgoing turn. The surface's send handler calls {@link takeClipText} to
	 * fold that text in. Stable identity, safe to call from an effect/handler.
	 */
	attachClip: (text: string, frames: ComposerSendFile[]) => void;
	/** Pass to `<AgentChat attachments={...}>` so the composer "+" stages images. */
	attachments: {
		images: AttachedImage[];
		onAttach: () => void;
		onPaste: (e: React.ClipboardEvent) => void;
		onRemoveImage: (id: string) => void;
	};
	/** Stable `InputBar` slot for `AgentChat`'s `slots.InputBar`. */
	inputBar: (props: InputBarProps) => ReactNode;
	/**
	 * The universal picker body (Ryu (providers nested) · External Agents) — pass
	 * to `EmptyStateHeader`'s `renderBody` so its logo opens the identical grouped
	 * dropdown as the composer's settings trigger.
	 */
	renderBody: (close: () => void) => ReactNode;
	/**
	 * The composed Agent · Model · Thinking sections — the SAME ones inside the
	 * composer's settings menu — so an empty-state logo can open the identical
	 * dropdown (exactly like ChatPage's `EmptyStateHeader`).
	 */
	sections: ComposerSettingsSection[];
	/**
	 * Pull the queued clip context text (from {@link attachClip}) and clear it.
	 * Call in the surface's send handler and prepend it to the outgoing text so
	 * the agent reads it as one leading `type:"text"` part. Returns `""` when no
	 * clip is queued, so the non-clip path is byte-identical.
	 */
	takeClipText: () => string;
	/**
	 * Pull the staged images as AI-SDK file parts and clear them. Call inside the
	 * surface's send handler:
	 * `const files = takeImages(); sendMessage(files ? { text, files } : { text });`
	 */
	takeImages: () => ComposerSendFile[] | undefined;
	/**
	 * Render this near the surface root: the full-screen voice-mode overlay while a
	 * session is open, else `null`.
	 */
	voiceModeOverlay: ReactNode;
}

export interface ComposerSlotOptions {
	/** Single-row compact layout (used once the thread has history). */
	compact?: boolean;
	/**
	 * Compact the agent-picker trigger only (`[logo] agent [usage]`), keeping the
	 * roomy stacked textarea. Used by the narrow Ask Ryu floating/docked panel.
	 */
	compactTrigger?: boolean;
	/** Bind voice-mode turns to this conversation so history persists. */
	conversationId?: string;
	/**
	 * Text-to-image generation. When provided, the composer's toolbar gains an
	 * image button (the SAME one ChatPage wires) that takes the composer text as
	 * the prompt, generates via Core's `/api/images/generate`, and clears the
	 * draft — the host surfaces the result inline. Omit to hide the button (e.g.
	 * builder panes, where free-form image-gen doesn't belong). Mirrors `voice`:
	 * the draft text is owned by the InputBar, so the host receives only the prompt.
	 */
	onGenerateImage?: (prompt: string) => void | Promise<void>;
	/** Composer placeholder override (builders use "Describe what to build…"). */
	placeholder?: string;
	/** Node target for voice STT + realtime voice mode. */
	target: ApiTarget;
}

/**
 * The shared full composer for the Ask Ryu dock + builder panes. Returns a stable
 * `InputBar` slot (agent/model/thinking controls + voice + voice mode + attach +
 * compact), the staged-image `attachments` for `AgentChat`, a `takeImages()` the
 * surface folds into its send, the composed `sections` for the empty-state logo,
 * and the `voiceModeOverlay` to render.
 */
export function useComposerSlot(
	runtime: BuilderRuntime,
	options: ComposerSlotOptions
): ComposerSlot {
	const {
		target,
		compact = false,
		compactTrigger = false,
		placeholder,
		conversationId,
		onGenerateImage,
	} = options;
	const { agents } = useAgents();

	// The agent's ACP-advertised Model + Thinking/approval selectors, derived the
	// same way ChatPage and the launchpad derive them (shared hook), so this
	// surface's dropdown reads identically. Picks persist per-agent.
	const acp = useComposerAcpSections({
		agentId: runtime.agentId,
		agents,
		modelOptions: runtime.modelOptions,
		engineModel: runtime.effectiveModel,
		onEngineModelChange: runtime.setModel,
	});

	// The shared composer controls, driven by this surface's runtime selection.
	const { leftActions, rightActions, sections, renderBody } =
		useComposerAgentControls({
			agents,
			agentId: runtime.agentId,
			onSelectAgent: runtime.setAgentId,
			modelOptions: runtime.modelOptions,
			model: runtime.effectiveModel,
			onModelChange: runtime.setModel,
			modelSection: acp.modelSection,
			extraSections: acp.extraSections,
			compact,
			compactTrigger,
		});

	// Staged image attachments (the composer "+"). Data URL for the model turn;
	// also persisted into the Uploads system space (best-effort), matching ChatPage.
	const [images, setImages] = useState<AttachedImage[]>([]);
	const addImages = useCallback(
		(files: File[]) => {
			const imageFiles = files.filter((f) => f.type.startsWith("image/"));
			for (const file of imageFiles) {
				void stageImageUpload(target, file).then(({ dataUrl, upload }) => {
					setImages((prev) => [
						...prev,
						{
							id: upload?.id ?? `img-${Date.now()}-${Math.random()}`,
							filename: file.name,
							url: dataUrl,
							mimeType: file.type,
							size: file.size,
						},
					]);
				});
			}
		},
		[target]
	);
	const onAttach = useCallback(() => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.multiple = true;
		input.onchange = () => {
			if (input.files) {
				addImages(Array.from(input.files));
			}
		};
		input.click();
	}, [addImages]);
	const onPaste = useCallback(
		(e: React.ClipboardEvent) => addImages(Array.from(e.clipboardData.files)),
		[addImages]
	);
	const onRemoveImage = useCallback(
		(id: string) => setImages((prev) => prev.filter((img) => img.id !== id)),
		[]
	);
	const imagesRef = useRef(images);
	imagesRef.current = images;
	const takeImages = useCallback((): ComposerSendFile[] | undefined => {
		const current = imagesRef.current;
		if (current.length === 0) {
			return;
		}
		setImages([]);
		return current.map((img) => ({
			type: "file" as const,
			mediaType: img.mimeType ?? "image/png",
			filename: img.filename,
			url: img.url,
		}));
	}, []);

	// Queued Ryu Clip context. Frames are pushed into `images` (so they render as
	// chips + ride `takeImages` unchanged); the markdown summary is buffered here
	// and folded into the outgoing text by the surface via `takeClipText`. Only
	// `setImages` (stable) + this ref (stable) are captured, so `attachClip` keeps
	// a stable identity without needing the liveRef indirection.
	const pendingClipText = useRef("");
	const attachClip = useCallback((text: string, frames: ComposerSendFile[]) => {
		if (frames.length > 0) {
			setImages((prev) => [
				...prev,
				...frames.map((frame, index) => ({
					id: `clip-${Date.now()}-${index}-${Math.random()}`,
					filename: frame.filename,
					url: frame.url,
					mimeType: "image/jpeg",
				})),
			]);
		}
		const trimmed = text.trim();
		if (trimmed) {
			pendingClipText.current = pendingClipText.current
				? `${pendingClipText.current}\n\n${trimmed}`
				: trimmed;
		}
	}, []);
	const takeClipText = useCallback((): string => {
		const text = pendingClipText.current;
		pendingClipText.current = "";
		return text;
	}, []);

	// STT dictation: a stable transcribe fn (reads the live node target via a ref)
	// so the memoized slot never remounts and drops textarea focus.
	const targetRef = useRef(target);
	targetRef.current = target;
	const transcribe = useCallback(
		(audio: Blob) => transcribeAudio(targetRef.current, audio),
		[]
	);

	// ChatGPT-style continuous voice mode — its own entry point, separate from the
	// push-to-talk dictation above. The surface renders `voiceModeOverlay`.
	const voiceMode = useVoiceMode(target, {
		agentId: runtime.agentId,
		conversationId,
	});
	const composerShortcuts = useComposerShortcutBindings();

	// Every injected prop rides one ref so the memoized slot identity stays stable.
	const liveRef = useRef<{
		compact: boolean;
		left: ReactNode;
		onGenerateImage?: (prompt: string) => void | Promise<void>;
		onStartVoiceMode: () => void;
		placeholder?: string;
		right: ReactNode;
		sections: ComposerSettingsSection[];
		shortcuts: typeof composerShortcuts;
	}>({
		compact,
		left: leftActions,
		onGenerateImage,
		onStartVoiceMode: voiceMode.start,
		placeholder,
		right: rightActions,
		sections,
		shortcuts: composerShortcuts,
	});
	liveRef.current = {
		compact,
		left: leftActions,
		onGenerateImage,
		onStartVoiceMode: voiceMode.start,
		placeholder,
		right: rightActions,
		sections,
		shortcuts: composerShortcuts,
	};

	const inputBar = useMemo(
		() =>
			function BoundComposerInputBar(props: InputBarProps) {
				const live = liveRef.current;
				return (
					<InputBar
						{...props}
						compact={live.compact}
						leftActions={live.left}
						onGenerateImage={live.onGenerateImage}
						onTextareaKeyDown={(event) => {
							if (
								handleComposerSettingsShortcut(
									event,
									live.sections,
									live.shortcuts
								)
							) {
								event.preventDefault();
							}
							props.onTextareaKeyDown?.(event);
						}}
						placeholder={live.placeholder ?? props.placeholder}
						rightActions={live.right}
						voice={{ transcribe }}
						voiceMode={{ onStart: live.onStartVoiceMode }}
					/>
				);
			},
		[transcribe]
	);

	const voiceModeOverlay = voiceMode.active ? (
		<VoiceModeSurface voice={voiceMode} />
	) : null;

	return {
		attachClip,
		attachments: { images, onAttach, onPaste, onRemoveImage },
		inputBar,
		renderBody,
		sections,
		takeClipText,
		takeImages,
		voiceModeOverlay,
	};
}
