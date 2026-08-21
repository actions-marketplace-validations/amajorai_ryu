import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ImageLightbox } from "@ryu/blocks/desktop/agent-elements/image-lightbox";
import { Button } from "@ryu/ui/components/button.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
	clearMediaSource,
	getMediaSourceSnapshot,
	MEDIA_RECORDING_EVENT,
	type MediaSource,
	mediaRecordingSource,
	publishMediaSource,
	requestMediaSource,
	subscribeMediaSource,
} from "@/src/lib/media-pip.ts";
import { invokeWhenReady, isTauriReady } from "@/src/lib/tauri-ready.ts";

function useMediaSource(): MediaSource | null {
	return useSyncExternalStore(
		subscribeMediaSource,
		getMediaSourceSnapshot,
		getMediaSourceSnapshot
	);
}

function sourceKindLabel(source: MediaSource): string {
	if (source.kind === "desktop") {
		return "Remote desktop";
	}
	if (source.kind === "recording") {
		return "Evidence recording";
	}
	if (source.kind === "agent-browser") {
		return "Agent Browser";
	}
	return "Browser tab";
}

interface LiveMediaLightboxProps {
	onClose: () => void;
	open: boolean;
	originRef: React.RefObject<HTMLElement | null>;
	source: MediaSource;
}

/** Video counterpart to ImageLightbox: same origin thumbnail, but keeps a
 * recording playable instead of flattening it to a poster frame. */
function LiveMediaLightbox({
	onClose,
	open,
	originRef,
	source,
}: LiveMediaLightboxProps) {
	const reduced = useReducedMotion();
	const [mounted, setMounted] = useState(false);
	const [origin, setOrigin] = useState<DOMRect | null>(null);

	useEffect(() => setMounted(true), []);
	useLayoutEffect(() => {
		if (open) {
			setOrigin(originRef.current?.getBoundingClientRect() ?? null);
		}
	}, [open, originRef]);
	useEffect(() => {
		if (!open) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose, open]);

	if (!mounted || typeof document === "undefined") {
		return null;
	}

	const initial = origin
		? {
				x: origin.left + origin.width / 2 - window.innerWidth / 2,
				y: origin.top + origin.height / 2 - window.innerHeight / 2,
				scale: Math.max(
					0.08,
					origin.width / Math.min(window.innerWidth - 32, 960)
				),
				opacity: 1,
			}
		: { opacity: 0, scale: 0.96 };

	return createPortal(
		<AnimatePresence>
			{open && (
				<motion.div
					aria-label={`${source.title} fullscreen`}
					aria-modal="true"
					className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm sm:p-12"
					data-media-lightbox="true"
					data-media-lightbox-kind="recording"
					onClick={onClose}
					role="dialog"
				>
					<motion.div
						animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
						className="relative flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl"
						initial={reduced ? false : initial}
						onClick={(event) => event.stopPropagation()}
						transition={
							reduced
								? { duration: 0 }
								: { damping: 28, stiffness: 190, type: "spring" }
						}
					>
						<video
							aria-label={source.title}
							autoPlay
							className="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] object-contain sm:max-h-[calc(100vh-6rem)] sm:max-w-[calc(100vw-6rem)]"
							controls
							playsInline
							poster={source.posterUrl}
							src={source.videoUrl}
						/>
						<button
							aria-label="Close fullscreen media"
							className="absolute top-3 right-3 grid size-9 place-items-center rounded-full border border-white/10 bg-black/60 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/80"
							onClick={onClose}
							type="button"
						>
							<HugeiconsIcon className="size-4" icon={Cancel01Icon} />
						</button>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>,
		document.body
	);
}

export function MediaPipDock() {
	const source = useMediaSource();
	const [lightboxOpen, setLightboxOpen] = useState(false);
	const [pipError, setPipError] = useState<string | null>(null);
	const originRef = useRef<HTMLButtonElement>(null);

	useAgentBrowserStream();

	useEffect(() => {
		const onRecording = (event: Event) => {
			const next = mediaRecordingSource((event as CustomEvent).detail);
			if (next) {
				publishMediaSource(next);
			}
		};
		window.addEventListener(MEDIA_RECORDING_EVENT, onRecording);
		return () => window.removeEventListener(MEDIA_RECORDING_EVENT, onRecording);
	}, []);

	useEffect(() => {
		setLightboxOpen(false);
	}, [source?.id]);

	const openPip = async () => {
		setPipError(null);
		try {
			await invokeWhenReady("open_media_pip");
			window.setTimeout(requestMediaSource, 80);
		} catch (error) {
			setPipError(
				error instanceof Error ? error.message : "PiP is unavailable"
			);
		}
	};

	if (!source) {
		return null;
	}

	const imageUrl = source.imageUrl ?? source.posterUrl;
	const isVideo = Boolean(source.videoUrl);
	const previewLabel = `${source.title} live preview`;

	return (
		<>
			<AnimatePresence>
				<motion.section
					animate={{ opacity: 1, y: 0 }}
					aria-label="Live media"
					className="fixed right-4 bottom-4 z-[70] w-64 overflow-hidden rounded-2xl border border-border/70 bg-background/95 shadow-2xl backdrop-blur-xl"
					data-media-pip-dock="true"
					exit={{ opacity: 0, y: 18 }}
					initial={{ opacity: 0, y: 18 }}
				>
					<button
						aria-label={`Expand ${previewLabel}`}
						className="group relative block aspect-video w-full overflow-hidden bg-black/80 text-left"
						data-media-pip-preview="true"
						onClick={() => setLightboxOpen(true)}
						ref={originRef}
						type="button"
					>
						{isVideo ? (
							<video
								aria-label={previewLabel}
								autoPlay
								className="h-full w-full object-cover"
								loop
								muted
								playsInline
								poster={source.posterUrl}
								src={source.videoUrl}
							/>
						) : imageUrl ? (
							// biome-ignore lint/performance/noImgElement: live frames are data URLs, not static assets.
							<img
								alt={previewLabel}
								className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
								src={imageUrl}
							/>
						) : (
							<div className="flex h-full items-center justify-center text-muted-foreground text-xs">
								Waiting for media…
							</div>
						)}
						<div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-3 pt-5 pb-2 text-white">
							<span className="truncate text-[11px]">
								{sourceKindLabel(source)}
							</span>
							<span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" />
						</div>
					</button>
					<div className="flex items-center gap-2 px-3 py-2.5">
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium text-foreground text-xs">
								{source.title}
							</p>
							<p className="truncate text-[11px] text-muted-foreground">
								{isVideo
									? "Recording is ready"
									: source.kind === "recording"
										? "Latest captured frame"
										: "Following the active tab"}
							</p>
						</div>
						<Button
							className="h-7 px-2 text-[11px]"
							data-media-pip-open="true"
							onClick={openPip}
							variant="secondary"
						>
							Open PiP
						</Button>
					</div>
					{pipError && (
						<p className="px-3 pb-2 text-[10px] text-destructive">{pipError}</p>
					)}
				</motion.section>
			</AnimatePresence>
			{imageUrl && !isVideo && (
				<ImageLightbox
					images={[{ id: source.id, filename: source.title, url: imageUrl }]}
					onClose={() => setLightboxOpen(false)}
					open={lightboxOpen}
					originRef={originRef}
				/>
			)}
			{isVideo && (
				<LiveMediaLightbox
					onClose={() => setLightboxOpen(false)}
					open={lightboxOpen}
					originRef={originRef}
					source={source}
				/>
			)}
		</>
	);
}

interface AgentBrowserStreamStatus {
	connected: boolean;
	enabled: boolean;
	port: number | null;
	screencasting: boolean;
}

function isAgentBrowserFrame(
	value: unknown
): value is { data: string; type: "frame" } {
	if (!value || typeof value !== "object") {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return candidate.type === "frame" && typeof candidate.data === "string";
}

/** Bridges the documented Agent Browser localhost stream into the same media
 * source used by the Browser and Virtual Desktop dock panels. It is fail-soft:
 * a normal desktop with no Agent Browser process simply has no extra source. */
function useAgentBrowserStream(): void {
	const socketRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		if (!isTauriReady()) {
			return;
		}
		let disposed = false;

		const connect = async () => {
			if (disposed || socketRef.current) {
				return;
			}
			const status = await invokeWhenReady<AgentBrowserStreamStatus>(
				"agent_browser_stream_status"
			).catch(() => null);
			if (disposed || !status?.enabled || !status.port) {
				return;
			}
			const socket = new WebSocket(`ws://127.0.0.1:${status.port}`);
			socketRef.current = socket;
			socket.addEventListener("open", () => {
				socket.send(JSON.stringify({ maxFps: 8, type: "config" }));
			});
			socket.addEventListener("message", (event) => {
				try {
					const message: unknown = JSON.parse(String(event.data));
					if (!isAgentBrowserFrame(message)) {
						return;
					}
					const current = getMediaSourceSnapshot();
					if (
						current &&
						(current.kind === "browser" || current.kind === "desktop") &&
						Date.now() - current.updatedAt < 2000
					) {
						return;
					}
					publishMediaSource({
						id: "agent-browser:active",
						imageUrl: `data:image/jpeg;base64,${message.data}`,
						kind: "agent-browser",
						title: "Agent Browser",
					});
				} catch {
					// Ignore malformed frames; the next stream frame remains usable.
				}
			});
			const clearSocket = () => {
				if (socketRef.current === socket) {
					socketRef.current = null;
				}
			};
			socket.addEventListener("close", clearSocket);
			socket.addEventListener("error", clearSocket);
		};

		connect().catch(() => undefined);
		const timer = window.setInterval(() => {
			connect().catch(() => undefined);
		}, 5000);
		return () => {
			disposed = true;
			window.clearInterval(timer);
			socketRef.current?.close();
			socketRef.current = null;
			clearMediaSource("agent-browser:active");
		};
	}, []);
}

export function MediaPipWindow() {
	const source = useMediaSource();

	useEffect(() => {
		requestMediaSource();
	}, []);

	const close = () => {
		invokeWhenReady("close_media_pip").catch(() => undefined);
	};

	return (
		<div
			className="flex h-screen min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background text-foreground shadow-2xl"
			data-media-pip-window="true"
		>
			<header
				className="flex h-9 shrink-0 items-center gap-2 border-border/60 border-b bg-sidebar/90 px-3"
				data-tauri-drag-region
			>
				<span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
				<span className="min-w-0 flex-1 truncate font-medium text-xs">
					{source?.title ?? "Live media"}
				</span>
				<button
					aria-label="Close picture in picture"
					className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
					onClick={close}
					type="button"
				>
					<HugeiconsIcon className="size-3.5" icon={Cancel01Icon} />
				</button>
			</header>
			<div
				className={cn(
					"relative min-h-0 flex-1 bg-black",
					!source && "grid place-items-center p-5"
				)}
			>
				{source?.videoUrl ? (
					<video
						aria-label={source.title}
						autoPlay
						className="h-full w-full object-contain"
						controls
						loop
						muted
						playsInline
						poster={source.posterUrl}
						src={source.videoUrl}
					/>
				) : source?.imageUrl ? (
					// biome-ignore lint/performance/noImgElement: live frame data URLs are not static assets.
					<img
						alt={source.title}
						className="h-full w-full object-contain"
						src={source.imageUrl}
					/>
				) : (
					<p className="text-center text-muted-foreground text-xs">
						Waiting for a browser, desktop, or evidence source…
					</p>
				)}
			</div>
		</div>
	);
}
