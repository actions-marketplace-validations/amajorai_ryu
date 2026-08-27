import {
	Comment01Icon,
	Mic01Icon,
	RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@ryu/ui/lib/utils.ts";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

export interface BrowserRect {
	height: number;
	width: number;
	x: number;
	y: number;
}

export interface BrowserStyleAdjust {
	background_color?: string;
	color?: string;
	font_family?: string;
	font_size?: string;
	font_weight?: string;
	letter_spacing?: string;
	line_height?: string;
	margin?: string;
	padding?: string;
}

export interface BrowserElementContext {
	attributes: Record<string, string>;
	component?: string;
	computed_styles: Record<string, string>;
	content_preview?: string;
	name?: string;
	rect: BrowserRect;
	ref?: string;
	role?: string;
	selector: string;
	tag: string;
	text?: string;
	xpath: string;
}

export interface BrowserWebMCPTool {
	annotations: {
		readOnlyHint: boolean;
		untrustedContentHint: boolean;
	};
	description: string;
	input_schema: string;
	name: string;
	origin: string;
	title: string;
}

export type BrowserAnnotationKind = "area" | "element" | "elements";

export interface BrowserAnnotation {
	comment: string;
	created_at: string;
	id: string;
	kind: BrowserAnnotationKind;
	rect: BrowserRect;
	style?: BrowserStyleAdjust;
	targets: BrowserElementContext[];
}

export interface BrowserContextResult {
	annotations: BrowserAnnotation[];
	page: { id: string; title: string; url: string };
	screenshot?: { encoding: "base64"; image: string; mime: "image/png" };
	selection?: {
		rect: BrowserRect;
		targets: BrowserElementContext[];
	};
	snapshot: {
		elements: Array<{
			depth: number;
			name?: string;
			props?: Record<string, boolean | number | string>;
			ref: string;
			role: string;
			value?: string;
		}>;
		snapshot_id: string;
		tab: { id: string; title: string; url: string };
		truncated: boolean;
	};
	viewport: {
		height: number;
		scroll_x: number;
		scroll_y: number;
		width: number;
	};
	webmcp_tools?: BrowserWebMCPTool[];
}

export interface BrowserAnnotationInput {
	comment: string;
	kind: BrowserAnnotationKind;
	rect: BrowserRect;
	selections?: BrowserRect[];
	style?: BrowserStyleAdjust;
}

interface BrowserAnnotationSurfaceProps {
	context: BrowserContextResult | null;
	imageUrl: string | null;
	isAnnotating: boolean;
	onAnnotate: (
		input: BrowserAnnotationInput
	) => Promise<BrowserAnnotation | null>;
	onAskRyu: () => void;
	onClearAnnotations: () => Promise<void>;
	onContext: (
		selections: BrowserRect[]
	) => Promise<BrowserContextResult | null>;
	onDeleteAnnotation: (id: string) => Promise<void>;
	onToggleAnnotating: () => void;
}

interface SpeechRecognitionResultLike {
	0?: { transcript?: string };
}

interface SpeechRecognitionEventLike {
	results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	onend: (() => void) | null;
	onerror: (() => void) | null;
	onresult: ((event: SpeechRecognitionEventLike) => void) | null;
	start: () => void;
	stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechWindow extends Window {
	SpeechRecognition?: SpeechRecognitionConstructor;
	webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

const MIN_AREA_SIZE = 8;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function rectFromPoints(
	start: { x: number; y: number },
	end: { x: number; y: number }
): BrowserRect {
	return {
		height: Math.abs(end.y - start.y),
		width: Math.abs(end.x - start.x),
		x: Math.min(start.x, end.x),
		y: Math.min(start.y, end.y),
	};
}

function unionRects(rects: BrowserRect[]): BrowserRect | null {
	if (rects.length === 0) {
		return null;
	}
	const left = Math.min(...rects.map((rect) => rect.x));
	const top = Math.min(...rects.map((rect) => rect.y));
	const right = Math.max(...rects.map((rect) => rect.x + rect.width));
	const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
	return { height: bottom - top, width: right - left, x: left, y: top };
}

function rectStyle(
	rect: BrowserRect,
	viewport: BrowserContextResult["viewport"]
): CSSProperties {
	return {
		height: `${(rect.height / viewport.height) * 100}%`,
		left: `${(rect.x / viewport.width) * 100}%`,
		top: `${(rect.y / viewport.height) * 100}%`,
		width: `${(rect.width / viewport.width) * 100}%`,
	};
}

function describeTarget(target: BrowserElementContext): string {
	const label = target.name || target.text || target.content_preview;
	return label ? `${target.tag} · ${label}` : target.selector;
}

function createRecognition(): SpeechRecognitionLike | null {
	if (typeof window === "undefined") {
		return null;
	}
	const speechWindow = window as SpeechWindow;
	const Constructor =
		speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
	return Constructor ? new Constructor() : null;
}

function extractTranscript(event: SpeechRecognitionEventLike): string {
	const transcript: string[] = [];
	for (const result of Array.from(event.results)) {
		const text = result[0]?.transcript?.trim();
		if (text) {
			transcript.push(text);
		}
	}
	return transcript.join(" ");
}

export function BrowserAnnotationSurface({
	context,
	imageUrl,
	isAnnotating,
	onAnnotate,
	onAskRyu,
	onClearAnnotations,
	onContext,
	onDeleteAnnotation,
	onToggleAnnotating,
}: BrowserAnnotationSurfaceProps) {
	const frameRef = useRef<HTMLDivElement>(null);
	const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
	const [draftComment, setDraftComment] = useState("");
	const [draftContext, setDraftContext] = useState<BrowserContextResult | null>(
		null
	);
	const [draftSelections, setDraftSelections] = useState<BrowserRect[]>([]);
	const [draftStyle, setDraftStyle] = useState<BrowserStyleAdjust>({});
	const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
		null
	);
	const [dragCurrent, setDragCurrent] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const [adjustOpen, setAdjustOpen] = useState(false);
	const [isListening, setIsListening] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	const viewport = context?.viewport ?? {
		height: 1,
		scroll_x: 0,
		scroll_y: 0,
		width: 1,
	};
	const annotations = context?.annotations ?? [];
	const draftRect =
		dragStart && dragCurrent ? rectFromPoints(dragStart, dragCurrent) : null;
	const selectedRect =
		draftContext?.selection?.rect ??
		(draftRect &&
		draftRect.width >= MIN_AREA_SIZE &&
		draftRect.height >= MIN_AREA_SIZE
			? draftRect
			: unionRects(draftSelections));
	const selectedTargets = draftContext?.selection?.targets ?? [];
	const draftKind: BrowserAnnotationKind =
		draftSelections.length > 1
			? "elements"
			: (selectedRect?.width ?? 0) >= MIN_AREA_SIZE &&
					(selectedRect?.height ?? 0) >= MIN_AREA_SIZE
				? "area"
				: "element";

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				(event.metaKey || event.ctrlKey) &&
				event.shiftKey &&
				event.key.toLowerCase() === "d"
			) {
				event.preventDefault();
				onToggleAnnotating();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onToggleAnnotating]);

	useEffect(() => {
		return () => recognitionRef.current?.stop();
	}, []);

	const toViewportPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
		const frame = frameRef.current?.getBoundingClientRect();
		if (!frame) {
			return null;
		}
		return {
			x: clamp(
				((event.clientX - frame.left) / frame.width) * viewport.width,
				0,
				viewport.width
			),
			y: clamp(
				((event.clientY - frame.top) / frame.height) * viewport.height,
				0,
				viewport.height
			),
		};
	};

	const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!(isAnnotating && context)) {
			return;
		}
		const point = toViewportPoint(event);
		if (!point) {
			return;
		}
		event.currentTarget.setPointerCapture(event.pointerId);
		setDragStart(point);
		setDragCurrent(point);
	};

	const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!dragStart) {
			return;
		}
		const point = toViewportPoint(event);
		if (point) {
			setDragCurrent(point);
		}
	};

	const handlePointerUp = async (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!(dragStart && context)) {
			return;
		}
		const point = toViewportPoint(event) ?? dragCurrent ?? dragStart;
		const nextRect = rectFromPoints(dragStart, point);
		const isPoint =
			nextRect.width < MIN_AREA_SIZE || nextRect.height < MIN_AREA_SIZE;
		const nextSelections = event.shiftKey
			? [
					...draftSelections,
					isPoint ? { ...nextRect, height: 0, width: 0 } : nextRect,
				]
			: [isPoint ? { ...nextRect, height: 0, width: 0 } : nextRect];
		setDragStart(null);
		setDragCurrent(null);
		setDraftSelections(nextSelections);
		const nextContext = await onContext(nextSelections);
		setDraftContext(nextContext);
	};

	const toggleVoice = () => {
		if (isListening) {
			recognitionRef.current?.stop();
			setIsListening(false);
			return;
		}
		const recognition = createRecognition();
		if (!recognition) {
			return;
		}
		recognition.continuous = true;
		recognition.interimResults = false;
		recognition.lang = "en-US";
		recognition.onresult = (event) => {
			const transcript = extractTranscript(event);
			if (transcript) {
				setDraftComment(
					(current) => `${current}${current ? " " : ""}${transcript}`
				);
			}
		};
		recognition.onerror = () => setIsListening(false);
		recognition.onend = () => setIsListening(false);
		recognitionRef.current = recognition;
		setIsListening(true);
		recognition.start();
	};

	const saveAnnotation = async () => {
		const comment = draftComment.trim();
		if (!(comment && selectedRect)) {
			return;
		}
		setIsSaving(true);
		const style = Object.fromEntries(
			Object.entries(draftStyle).filter(([, value]) => Boolean(value))
		) as BrowserStyleAdjust;
		try {
			const result = await onAnnotate({
				comment,
				kind: draftKind,
				rect: selectedRect,
				selections: draftSelections,
				style: Object.keys(style).length > 0 ? style : undefined,
			});
			if (result) {
				setDraftComment("");
				setDraftContext(null);
				setDraftSelections([]);
				setDraftStyle({});
			}
		} finally {
			setIsSaving(false);
		}
	};

	const updateStyle = (key: keyof BrowserStyleAdjust, value: string) => {
		setDraftStyle((current) => ({ ...current, [key]: value }));
	};

	return (
		<div
			className="flex min-h-0 flex-1 flex-col bg-muted/20"
			data-testid="browser-annotation-surface"
		>
			<div className="flex shrink-0 flex-wrap items-center gap-1.5 border-border/60 border-b bg-background/90 px-2 py-1.5 text-xs">
				<button
					aria-pressed={isAnnotating}
					className={cn(
						"rounded-md border px-2 py-1 transition-colors",
						isAnnotating
							? "border-primary/50 bg-primary/10 text-primary"
							: "border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground"
					)}
					onClick={onToggleAnnotating}
					type="button"
				>
					<HugeiconsIcon
						className="mr-1 inline-block size-3.5"
						icon={Comment01Icon}
					/>
					{isAnnotating ? "Annotation mode on" : "Annotate"}
				</button>
				<span className="text-muted-foreground">
					{isAnnotating
						? "Click an element or drag an area · Shift-click adds targets"
						: "Add visual feedback to the live browser frame"}
				</span>
				<div className="ml-auto flex items-center gap-1">
					{annotations.length > 0 && (
						<button
							className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
							onClick={() => onClearAnnotations().catch(() => undefined)}
							type="button"
						>
							Clear notes
						</button>
					)}
					<button
						className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
						onClick={onAskRyu}
						type="button"
					>
						Ask Ryu to address notes
					</button>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-auto p-3">
				{imageUrl ? (
					<div className="flex min-h-full min-w-full items-center justify-center">
						<div
							className={cn(
								"relative inline-block max-h-full max-w-full overflow-hidden rounded-lg border border-border/70 bg-white shadow-sm",
								isAnnotating && "cursor-crosshair"
							)}
							data-testid="browser-annotation-frame"
							onPointerDown={handlePointerDown}
							onPointerMove={handlePointerMove}
							onPointerUp={(event) =>
								handlePointerUp(event).catch(() => undefined)
							}
							ref={frameRef}
						>
							{/* biome-ignore lint/performance/noImgElement: browser screenshots are data URIs captured from the local sidecar. */}
							<img
								alt={context?.page.title || "Embedded browser tab"}
								className="block max-h-[calc(100vh-13rem)] max-w-[calc(100vw-15rem)] select-none object-contain"
								draggable={false}
								src={imageUrl}
							/>
							<div className="pointer-events-none absolute inset-0">
								{annotations.map((annotation, index) => (
									<div
										className="absolute rounded border-2 border-amber-400/90 bg-amber-300/10"
										data-testid={`browser-annotation-marker-${index + 1}`}
										key={annotation.id}
										style={rectStyle(annotation.rect, viewport)}
									>
										<span className="absolute -top-5 left-0 rounded bg-amber-400 px-1.5 py-0.5 font-medium text-[10px] text-black shadow-sm">
											{index + 1}
										</span>
									</div>
								))}
								{draftSelections.map((selection, index) => (
									<div
										className="absolute rounded border-2 border-primary bg-primary/10"
										key={`${selection.x}:${selection.y}:${index}`}
										style={rectStyle(selection, viewport)}
									/>
								))}
								{draftRect && (
									<div
										className="absolute rounded border-2 border-primary border-dashed bg-primary/10"
										style={rectStyle(draftRect, viewport)}
									/>
								)}
							</div>
						</div>
					</div>
				) : (
					<div className="flex h-full min-h-48 items-center justify-center text-center text-muted-foreground text-xs">
						<div>
							<HugeiconsIcon
								className="mx-auto mb-2 size-5"
								icon={RefreshIcon}
							/>
							Select a browser tab to capture its live frame.
						</div>
					</div>
				)}
			</div>

			{isAnnotating && selectedRect && (
				<div className="shrink-0 border-border/60 border-t bg-background p-3">
					<div className="mb-2 flex items-center gap-2 text-muted-foreground text-xs">
						<span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
							{draftKind === "area"
								? "Area selected"
								: `${selectedTargets.length || draftSelections.length || 1} target${(selectedTargets.length || draftSelections.length || 1) === 1 ? "" : "s"}`}
						</span>
						{selectedTargets.slice(0, 3).map((target) => (
							<span
								className="max-w-48 truncate"
								key={`${target.selector}:${target.rect.x}`}
								title={target.selector}
							>
								{describeTarget(target)}
							</span>
						))}
					</div>
					<div className="flex items-end gap-2">
						<textarea
							aria-label="Annotation comment"
							className="min-h-16 min-w-0 flex-1 resize-y rounded-md border border-border/70 bg-background px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/60"
							onChange={(event) => setDraftComment(event.target.value)}
							placeholder="Describe the change you want Ryu to make…"
							value={draftComment}
						/>
						<div className="flex shrink-0 flex-col gap-1">
							<button
								aria-label={
									isListening ? "Stop voice annotation" : "Dictate annotation"
								}
								className={cn(
									"rounded-md border p-2 text-muted-foreground hover:bg-accent hover:text-foreground",
									isListening && "border-primary/60 bg-primary/10 text-primary"
								)}
								onClick={toggleVoice}
								type="button"
							>
								<HugeiconsIcon className="size-4" icon={Mic01Icon} />
							</button>
							<button
								className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-xs disabled:cursor-not-allowed disabled:opacity-50"
								disabled={!draftComment.trim() || isSaving}
								onClick={() => saveAnnotation().catch(() => undefined)}
								type="button"
							>
								{isSaving ? "Saving…" : "Add note"}
							</button>
						</div>
					</div>
					<div className="mt-2 flex items-center justify-between">
						<button
							aria-expanded={adjustOpen}
							className="text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
							onClick={() => setAdjustOpen((open) => !open)}
							type="button"
						>
							{adjustOpen ? "Hide Adjust controls" : "Adjust styling"}
						</button>
						<span className="text-[11px] text-muted-foreground">
							⌘⇧D toggles mode
						</span>
					</div>
					{adjustOpen && (
						<div className="mt-2 grid grid-cols-2 gap-2 border-border/50 border-t pt-2 sm:grid-cols-4">
							{(
								[
									["font_size", "Font size"],
									["font_weight", "Weight"],
									["line_height", "Line height"],
									["letter_spacing", "Tracking"],
									["padding", "Padding"],
									["margin", "Margin"],
									["color", "Text color"],
									["background_color", "Fill color"],
								] as [keyof BrowserStyleAdjust, string][]
							).map(([key, label]) => (
								<label
									className="flex flex-col gap-1 text-[11px] text-muted-foreground"
									key={key}
								>
									{label}
									<input
										className="rounded border border-border/70 bg-background px-1.5 py-1 text-foreground text-xs outline-none focus:border-primary/60"
										onChange={(event) => updateStyle(key, event.target.value)}
										placeholder={
											key === "color" || key === "background_color"
												? "#…"
												: "e.g. 16px"
										}
										value={draftStyle[key] ?? ""}
									/>
								</label>
							))}
						</div>
					)}
				</div>
			)}

			{annotations.length > 0 && !isAnnotating && (
				<div className="max-h-32 shrink-0 space-y-1 overflow-y-auto border-border/60 border-t bg-background p-2">
					{annotations.map((annotation, index) => (
						<div
							className="flex items-start gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs dark:bg-amber-950/30"
							key={annotation.id}
						>
							<span className="mt-0.5 rounded-full bg-amber-400 px-1.5 py-0.5 font-medium text-[10px] text-black">
								{index + 1}
							</span>
							<p className="min-w-0 flex-1 text-foreground">
								{annotation.comment}
							</p>
							<button
								aria-label={`Remove annotation ${index + 1}`}
								className="text-muted-foreground hover:text-foreground"
								onClick={() =>
									onDeleteAnnotation(annotation.id).catch(() => undefined)
								}
								type="button"
							>
								×
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
