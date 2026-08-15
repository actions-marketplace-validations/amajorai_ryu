"use client";

import { Button } from "@ryu/ui/components/button";
import { cn } from "@ryu/ui/lib/utils";
import {
	IconChevronLeft,
	IconChevronRight,
	IconX,
	IconZoomIn,
	IconZoomOut,
} from "@tabler/icons-react";
import {
	AnimatePresence,
	animate,
	motion,
	useMotionValue,
	useReducedMotion,
} from "motion/react";
import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

export interface LightboxImage {
	/** Optional filename used for the alt text. */
	filename?: string;
	/** Stable identifier — used for keys and to know which image is active. */
	id: string;
	/** Resolvable image URL (https / data: / blob:). */
	url: string;
}

export interface ImageLightboxProps {
	/** Appended last to the fixed overlay shell. */
	className?: string;
	/** Full set of images for gallery navigation. */
	images: LightboxImage[];
	/** Index in `images` to start on. */
	initialIndex?: number;
	/** Ceiling for wheel, double-click and keyboard zoom. Values at or below
	 *  1.1 are raised to 1.1. */
	maxScale?: number;
	/** Close handler — wired to Escape, the close button, and a backdrop click
	 *  while unzoomed. The overlay stays mounted until the return flight ends. */
	onClose: () => void;
	/** Whether the overlay is mounted. The caller owns it, so the trigger stays
	 *  the caller's element. */
	open: boolean;
	/**
	 * The thumbnail the image morphs from and returns to. Point it at the
	 * clicked thumbnail in the click handler. Omitted, the overlay falls back
	 * to a 0.97-scale enter and exit.
	 */
	originRef?: React.RefObject<HTMLElement | null>;
}

const CELL = {
	type: "spring",
	stiffness: 520,
	damping: 34,
	mass: 0.45,
} as const;

const HOME = {
	type: "spring",
	stiffness: 150,
	damping: 27,
	mass: 1,
} as const;

const VEIL = {
	type: "spring",
	stiffness: 260,
	damping: 34,
	mass: 0.8,
} as const;

const EASE = [0.23, 1, 0.32, 1] as const;
const EXIT = { duration: 0.2, ease: [0.4, 0, 1, 1] } as const;

const TOGGLE = 2.5;
const KEY_ZOOM = 1.6;
const KEY_PAN = 56;
const WHEEL_RATE = 140;
const SLOP = 8;
const NEAR_HOME = 1.02;
const SNAP_HOME = 1.05;

const CHROME_BUTTON =
	"grid size-9 place-items-center rounded-full border border-white/10 bg-black/50 text-white outline-none backdrop-blur-sm transition-[border-color,background-color,color] duration-150 hover:border-white/25 hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white/60";

interface Spring {
	damping: number;
	mass: number;
	stiffness: number;
	type: "spring";
}

const clamp = (v: number, lo: number, hi: number) =>
	Math.min(hi, Math.max(lo, v));

interface Drag {
	from: { x: number; y: number };
	id: number;
	x: number;
	y: number;
}

interface UseLightboxOptions {
	disabled?: boolean;
	maxScale?: number;
	onDismiss?: () => void;
	steps?: number;
}

function useLightbox<
	Frame extends HTMLElement = HTMLDivElement,
	Content extends HTMLElement = HTMLImageElement,
>({
	maxScale = 4,
	steps = 8,
	disabled = false,
	onDismiss,
}: UseLightboxOptions = {}) {
	const cells = Math.max(1, Math.round(steps));
	const top = Math.max(1.1, maxScale);

	const frameRef = useRef<Frame>(null);
	const contentRef = useRef<Content>(null);

	const scale = useMotionValue(1);
	const x = useMotionValue(0);
	const y = useMotionValue(0);

	const [step, setStep] = useState(0);
	const [settled, setSettled] = useState(0);

	const stepRef = useRef(0);
	const settledRef = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const drag = useRef<Drag | null>(null);
	const onContent = useRef(false);

	const reduced = useReducedMotion();
	const dismiss = useRef(onDismiss);
	dismiss.current = onDismiss;

	const toStep = useCallback(
		(s: number) => clamp(Math.round(((s - 1) / (top - 1)) * cells), 0, cells),
		[cells, top]
	);

	const mark = useCallback(
		(s: number) => {
			const next = toStep(s);
			if (stepRef.current === next) {
				return;
			}
			stepRef.current = next;
			setStep(next);
		},
		[toStep]
	);

	const settle = useCallback(
		(s: number) => {
			if (timer.current) {
				clearTimeout(timer.current);
				timer.current = null;
			}
			const next = toStep(s);
			if (settledRef.current === next) {
				return;
			}
			settledRef.current = next;
			setSettled(next);
		},
		[toStep]
	);

	const settleSoon = useCallback(
		(s: number) => {
			if (timer.current) {
				clearTimeout(timer.current);
			}
			timer.current = setTimeout(() => {
				timer.current = null;
				settle(s);
			}, 220);
		},
		[settle]
	);

	const limit = useCallback((s: number) => {
		const frame = frameRef.current;
		const content = contentRef.current;
		if (!(frame && content)) {
			return { mx: 0, my: 0 };
		}
		return {
			mx: Math.max(0, (content.offsetWidth * s - frame.clientWidth) / 2),
			my: Math.max(0, (content.offsetHeight * s - frame.clientHeight) / 2),
		};
	}, []);

	const place = useCallback(
		(s: number, nx: number, ny: number) => {
			const { mx, my } = limit(s);
			scale.set(s);
			x.set(clamp(nx, -mx, mx));
			y.set(clamp(ny, -my, my));
			mark(s);
		},
		[limit, mark, scale, x, y]
	);

	const glide = useCallback(
		(s: number, nx: number, ny: number, spring: Spring = CELL) => {
			const { mx, my } = limit(s);
			const tx = clamp(nx, -mx, mx);
			const ty = clamp(ny, -my, my);
			if (reduced) {
				scale.set(s);
				x.set(tx);
				y.set(ty);
			} else {
				animate(scale, s, spring);
				animate(x, tx, spring);
				animate(y, ty, spring);
			}
			mark(s);
			settle(s);
		},
		[limit, mark, reduced, scale, settle, x, y]
	);

	const reset = useCallback(() => {
		glide(1, 0, 0, HOME);
	}, [glide]);

	const zoomAt = useCallback(
		(next: number, cx: number, cy: number, animated: boolean) => {
			const frame = frameRef.current;
			if (!frame) {
				return;
			}
			const r = frame.getBoundingClientRect();
			const px = cx - (r.left + r.width / 2);
			const py = cy - (r.top + r.height / 2);
			const s0 = scale.get();
			const ax = (px - x.get()) / s0;
			const ay = (py - y.get()) / s0;
			const s = clamp(next, 1, top);
			const nx = px - ax * s;
			const ny = py - ay * s;
			if (animated) {
				glide(s, nx, ny, s <= 1 ? HOME : CELL);
				return;
			}
			place(s, nx, ny);
			settleSoon(s);
		},
		[glide, place, scale, settleSoon, top, x, y]
	);

	const finish = useCallback(() => {
		const s0 = scale.get();
		if (s0 < SNAP_HOME) {
			reset();
		} else {
			settle(s0);
		}
	}, [reset, scale, settle]);

	const release = (e: React.PointerEvent) => {
		const held = drag.current;
		if (!held || held.id !== e.pointerId) {
			return;
		}
		drag.current = null;
		const moved = Math.hypot(e.clientX - held.from.x, e.clientY - held.from.y);
		if (moved < SLOP && !onContent.current && scale.get() <= NEAR_HOME) {
			dismiss.current?.();
			return;
		}
		finish();
	};

	const cancel = (e: React.PointerEvent) => {
		const held = drag.current;
		if (!held || held.id !== e.pointerId) {
			return;
		}
		drag.current = null;
		finish();
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		const frame = frameRef.current;
		if (!frame || disabled) {
			return;
		}
		const r = frame.getBoundingClientRect();
		const cx = r.left + r.width / 2;
		const cy = r.top + r.height / 2;
		const s0 = scale.get();

		if (e.key === "+" || e.key === "=") {
			e.preventDefault();
			zoomAt(s0 * KEY_ZOOM, cx, cy, true);
			return;
		}
		if (e.key === "-" || e.key === "_") {
			e.preventDefault();
			zoomAt(s0 / KEY_ZOOM, cx, cy, true);
			return;
		}
		if (e.key === "0") {
			e.preventDefault();
			reset();
			return;
		}
		if (e.key === "Escape" && s0 > NEAR_HOME) {
			e.preventDefault();
			e.stopPropagation();
			reset();
			return;
		}
		if (s0 > NEAR_HOME && e.key.startsWith("Arrow")) {
			e.preventDefault();
			const dx =
				e.key === "ArrowLeft" ? KEY_PAN : e.key === "ArrowRight" ? -KEY_PAN : 0;
			const dy =
				e.key === "ArrowUp" ? KEY_PAN : e.key === "ArrowDown" ? -KEY_PAN : 0;
			glide(s0, x.get() + dx, y.get() + dy);
		}
	};

	const bind = {
		onPointerDown: (e: React.PointerEvent) => {
			if (disabled) {
				return;
			}
			if (e.pointerType === "mouse" && e.button !== 0) {
				return;
			}
			const content = contentRef.current;
			onContent.current = content ? content.contains(e.target as Node) : false;
			e.currentTarget.setPointerCapture?.(e.pointerId);
			drag.current = {
				id: e.pointerId,
				from: { x: e.clientX, y: e.clientY },
				x: x.get(),
				y: y.get(),
			};
		},
		onPointerMove: (e: React.PointerEvent) => {
			const held = drag.current;
			if (!held || held.id !== e.pointerId) {
				return;
			}
			if (scale.get() <= 1) {
				return;
			}
			place(
				scale.get(),
				held.x + (e.clientX - held.from.x),
				held.y + (e.clientY - held.from.y)
			);
		},
		onPointerUp: release,
		onPointerCancel: cancel,
		onLostPointerCapture: cancel,
		onDoubleClick: (e: React.MouseEvent) => {
			if (disabled) {
				return;
			}
			zoomAt(
				scale.get() > SNAP_HOME ? 1 : Math.min(TOGGLE, top),
				e.clientX,
				e.clientY,
				true
			);
		},
		onKeyDown,
	};

	useEffect(() => {
		const frame = frameRef.current;
		if (!frame) {
			return;
		}
		const onWheel = (e: WheelEvent) => {
			if (disabled) {
				return;
			}
			e.preventDefault();
			zoomAt(
				scale.get() * Math.exp(-e.deltaY / WHEEL_RATE),
				e.clientX,
				e.clientY,
				false
			);
		};
		frame.addEventListener("wheel", onWheel, { passive: false });
		return () => frame.removeEventListener("wheel", onWheel);
	}, [disabled, scale, zoomAt]);

	useEffect(() => {
		const bail = () => {
			drag.current = null;
		};
		window.addEventListener("blur", bail);
		return () => {
			window.removeEventListener("blur", bail);
			if (timer.current) {
				clearTimeout(timer.current);
			}
		};
	}, []);

	return {
		frameRef,
		contentRef,
		bind,
		scale,
		x,
		y,
		step,
		steps: cells,
		zoom: 1 + (step / cells) * (top - 1),
		settledZoom: 1 + (settled / cells) * (top - 1),
		zoomed: step > 0,
		reset,
		zoomAt,
	};
}

interface Landing {
	dx: number;
	dy: number;
	o: number;
	r: number;
	s: number;
}

function Stage({
	onClose,
	images,
	initialIndex,
	originRef,
	maxScale = 4,
	className = "",
}: ImageLightboxProps) {
	const reduced = useReducedMotion();
	const titleId = useId();
	const hintId = useId();

	const [currentIndex, setCurrentIndex] = useState(initialIndex ?? 0);
	const [loaded, setLoaded] = useState(false);
	const [size, setSize] = useState<{ w: number; h: number } | null>(null);
	const landedRef = useRef(false);

	const currentImage = images[currentIndex] ?? images[0];
	const hasMultipleImages = images.length > 1;

	const fx = useMotionValue(0);
	const fy = useMotionValue(0);
	const fs = useMotionValue(1);
	const fo = useMotionValue(0);
	const fr = useMotionValue(14);

	const {
		frameRef,
		contentRef,
		bind,
		scale,
		x,
		y,
		zoomed,
		settledZoom,
		reset,
		zoomAt,
	} = useLightbox({ maxScale, onDismiss: onClose });

	const shellRef = useRef<HTMLDivElement>(null);

	const toggleZoom = useCallback(() => {
		const frame = frameRef.current;
		if (!frame) {
			return;
		}
		if (zoomed) {
			reset();
			return;
		}
		const r = frame.getBoundingClientRect();
		zoomAt(
			Math.min(TOGGLE, Math.max(1.1, maxScale)),
			r.left + r.width / 2,
			r.top + r.height / 2,
			true
		);
	}, [frameRef, maxScale, reset, zoomAt, zoomed]);

	const goToPrevious = useCallback(() => {
		reset();
		setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
	}, [images.length, reset]);

	const goToNext = useCallback(() => {
		reset();
		setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
	}, [images.length, reset]);

	const landing = useCallback((): Landing => {
		const frame = frameRef.current;
		const content = contentRef.current;
		const origin = originRef?.current;
		if (frame && content && origin && content.offsetWidth > 0) {
			const r = frame.getBoundingClientRect();
			const o = origin.getBoundingClientRect();
			if (o.width > 0) {
				const s = o.width / content.offsetWidth;
				const rad =
					Number.parseFloat(getComputedStyle(origin).borderTopLeftRadius) || 9;
				return {
					dx: o.left + o.width / 2 - (r.left + r.width / 2),
					dy: o.top + o.height / 2 - (r.top + r.height / 2),
					s,
					o: 1,
					r: rad / s,
				};
			}
		}
		return { dx: 0, dy: 10, s: 0.97, o: 0, r: 14 };
	}, [contentRef, frameRef, originRef]);

	useLayoutEffect(() => {
		if (reduced) {
			fx.set(0);
			fy.set(0);
			fs.set(1);
			fo.set(1);
			fr.set(14);
			landedRef.current = true;
			return;
		}
		if (!loaded || landedRef.current) {
			return;
		}
		landedRef.current = true;
		const d = landing();
		fx.set(d.dx);
		fy.set(d.dy);
		fs.set(d.s);
		fo.set(d.o);
		fr.set(d.r);

		const runs = [
			animate(fx, 0, HOME),
			animate(fy, 0, HOME),
			animate(fs, 1, HOME),
			animate(fo, 1, HOME),
			animate(fr, 14, HOME),
		];
		return () => runs.forEach((r) => r.stop());
	}, [fo, fr, fs, fx, fy, landing, loaded, reduced]);

	const away = useCallback(() => {
		if (reduced) {
			return { opacity: 0, transition: { duration: 0.12 } };
		}
		const d = landing();
		animate(fr, d.r, HOME);
		return {
			x: d.dx,
			y: d.dy,
			scale: d.s,
			opacity: d.o,
			filter: "blur(4px)",
			transition: HOME,
		};
	}, [fr, landing, reduced]);

	const unwind = useCallback(
		() => ({
			x: 0,
			y: 0,
			scale: 1,
			transition: reduced ? { duration: 0 } : HOME,
		}),
		[reduced]
	);

	useEffect(() => {
		const frame = frameRef.current;
		const previous =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const body = document.body;
		const overflow = body.style.overflow;
		const padding = body.style.paddingRight;
		const gap = window.innerWidth - document.documentElement.clientWidth;
		const base = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
		body.style.overflow = "hidden";
		if (gap > 0) {
			body.style.paddingRight = `${base + gap}px`;
		}
		frame?.focus({ preventScroll: true });
		return () => {
			body.style.overflow = overflow;
			body.style.paddingRight = padding;
			if (previous?.isConnected) {
				previous.focus({ preventScroll: true });
			}
		};
	}, [frameRef]);

	useEffect(() => {
		const shell = shellRef.current;
		if (!shell) {
			return;
		}

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (zoomed) {
					return;
				}
				e.preventDefault();
				onClose();
				return;
			}
			if (!zoomed && hasMultipleImages) {
				if (e.key === "ArrowLeft") {
					e.preventDefault();
					goToPrevious();
					return;
				}
				if (e.key === "ArrowRight") {
					e.preventDefault();
					goToNext();
					return;
				}
			}
			if (e.key !== "Tab") {
				return;
			}
			const nodes = Array.from(
				shell.querySelectorAll<HTMLElement>('[data-lightbox-focus="1"]')
			);
			if (nodes.length === 0) {
				return;
			}
			e.preventDefault();
			const here =
				document.activeElement instanceof HTMLElement
					? nodes.indexOf(document.activeElement)
					: -1;
			const next = e.shiftKey
				? here <= 0
					? nodes.length - 1
					: here - 1
				: here === -1 || here === nodes.length - 1
					? 0
					: here + 1;
			nodes[next]?.focus();
		};

		shell.addEventListener("keydown", onKeyDown);
		return () => shell.removeEventListener("keydown", onKeyDown);
	}, [goToNext, goToPrevious, hasMultipleImages, onClose, zoomed]);

	if (!currentImage) {
		return null;
	}

	const filename = currentImage.filename ?? "Image preview";
	const caption = currentImage.filename;

	return (
		<div
			aria-labelledby={titleId}
			aria-modal="true"
			className={`fixed inset-0 z-50 ${className}`}
			ref={shellRef}
			role="dialog"
		>
			<motion.div
				animate={{ opacity: 1 }}
				aria-hidden
				className="absolute inset-0 bg-black/90 backdrop-blur-sm"
				exit={{
					opacity: 0,
					transition: reduced ? { duration: 0 } : { duration: 0.3, ease: EASE },
				}}
				initial={{ opacity: 0 }}
				transition={reduced ? { duration: 0 } : VEIL}
			/>
			<div
				aria-describedby={hintId}
				aria-labelledby={titleId}
				className={`absolute inset-0 select-none overflow-hidden outline-none focus-visible:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4)] ${
					zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
				}`}
				data-lightbox-focus="1"
				ref={frameRef}
				role="group"
				style={{ touchAction: "none", WebkitTouchCallout: "none" }}
				tabIndex={-1}
				{...bind}
			>
				<motion.div
					animate={{ filter: "blur(0px)" }}
					className="absolute inset-0 flex items-center justify-center p-4 sm:p-14"
					exit="away"
					initial={reduced ? false : { filter: "blur(6px)" }}
					style={{ x: fx, y: fy, scale: fs, opacity: fo }}
					transition={
						reduced
							? { duration: 0 }
							: { filter: { duration: 0.35, ease: EASE } }
					}
					variants={{ away }}
				>
					<motion.img
						alt={filename}
						className="max-h-full max-w-full object-contain"
						draggable={false}
						exit="away"
						height={size?.h}
						onError={() => setLoaded(true)}
						onLoad={(e) => {
							setSize({
								w: e.currentTarget.naturalWidth,
								h: e.currentTarget.naturalHeight,
							});
							setLoaded(true);
						}}
						ref={contentRef}
						src={currentImage.url}
						style={{ x, y, scale, borderRadius: fr }}
						variants={{ away: unwind }}
						width={size?.w}
					/>
				</motion.div>
			</div>
			<motion.div
				animate={{ opacity: 1 }}
				className="pointer-events-none absolute inset-0 flex items-start justify-between gap-3 p-3 sm:p-4"
				exit={{ opacity: 0, transition: reduced ? { duration: 0 } : EXIT }}
				initial={{ opacity: 0 }}
				transition={reduced ? { duration: 0 } : VEIL}
			>
				<p
					className="pointer-events-auto max-w-[65%] truncate rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-[12.5px] text-white/90 backdrop-blur-sm"
					id={titleId}
				>
					{caption ?? filename}
				</p>
				<div className="pointer-events-auto flex items-center gap-2">
					<Button
						aria-label={zoomed ? "Zoom out" : "Zoom in"}
						className={CHROME_BUTTON}
						data-lightbox-focus="1"
						onClick={toggleZoom}
						size="icon"
						type="button"
						variant="ghost"
					>
						{zoomed ? (
							<IconZoomOut className="size-[15px]" />
						) : (
							<IconZoomIn className="size-[15px]" />
						)}
					</Button>
					<Button
						aria-label="Close"
						className={CHROME_BUTTON}
						data-lightbox-focus="1"
						onClick={onClose}
						size="icon"
						type="button"
						variant="ghost"
					>
						<IconX className="size-[15px]" />
					</Button>
				</div>
			</motion.div>

			{hasMultipleImages && (
				<>
					<Button
						aria-label="Previous image (←)"
						className={cn(
							CHROME_BUTTON,
							"pointer-events-auto absolute top-1/2 left-3 z-10 -translate-y-1/2 sm:left-4"
						)}
						data-lightbox-focus="1"
						onClick={goToPrevious}
						size="icon"
						type="button"
						variant="ghost"
					>
						<IconChevronLeft className="size-6" />
					</Button>
					<Button
						aria-label="Next image (→)"
						className={cn(
							CHROME_BUTTON,
							"pointer-events-auto absolute top-1/2 right-3 z-10 -translate-y-1/2 sm:right-4"
						)}
						data-lightbox-focus="1"
						onClick={goToNext}
						size="icon"
						type="button"
						variant="ghost"
					>
						<IconChevronRight className="size-6" />
					</Button>
					<div className="pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3">
						<div className="pointer-events-auto flex gap-2">
							{images.map((_, idx) => (
								<button
									aria-label={`Go to image ${idx + 1}`}
									className={cn(
										"size-2 rounded-full transition-all",
										idx === currentIndex
											? "scale-125 bg-white"
											: "bg-white/40 hover:bg-white/60"
									)}
									data-lightbox-focus="1"
									key={idx}
									onClick={() => {
										reset();
										setCurrentIndex(idx);
									}}
									type="button"
								/>
							))}
						</div>
						<span className="text-sm text-white/70">
							{currentIndex + 1} / {images.length}
						</span>
					</div>
				</>
			)}
			<p className="sr-only" id={hintId}>
				Scroll to zoom toward the pointer, or press plus and minus. Drag or use
				the arrow keys to pan, and double-click to switch between fit and
				close-up. Press zero to return to the starting frame; Escape returns
				home first, then closes.
			</p>
			<p className="sr-only" role="status">
				Zoom {settledZoom.toFixed(1)} times
			</p>
		</div>
	);
}

export function ImageLightbox(props: ImageLightboxProps) {
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	if (typeof document === "undefined") {
		return null;
	}
	if (!mounted) {
		return null;
	}

	return createPortal(
		<AnimatePresence>
			{props.open ? <Stage key="lightbox" {...props} /> : null}
		</AnimatePresence>,
		document.body
	);
}
