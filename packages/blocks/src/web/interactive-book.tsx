"use client";

/*!
 * Interactive Book adapted from Vengeance UI.
 * https://github.com/Ashutoshx7/VengeanceUI
 * Copyright (c) 2025-2026 Ashutoshx7. MIT License.
 * The upstream permission notice is retained in ../../THIRD_PARTY_NOTICES.md.
 */

import { cn } from "@ryu/ui/lib/utils";
import {
	BookOpen,
	ChevronLeft,
	ChevronRight,
	RotateCcw,
	X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

/** A page in the page-flip book used by product stories. */
export interface BookPage {
	backContent?: ReactNode;
	content: ReactNode;
	pageNumber: number;
	title?: string;
}

export interface InteractiveBookProps {
	bookAuthor?: string;
	bookTitle?: string;
	className?: string;
	coverKicker?: string;
	pages: BookPage[];
}

/**
 * Ryu-native adaptation of Vengeance UI's Interactive Book interaction.
 *
 * The interaction pattern is intentionally kept local to the blocks package so
 * product pages can use the same motion/reduced-motion conventions as the rest
 * of the website without adding a third UI dependency or a remote asset.
 */
export function InteractiveBook({
	bookAuthor = "Ryu",
	bookTitle = "Interactive Edition",
	className,
	coverKicker = "Open the boundary",
	pages,
}: InteractiveBookProps) {
	const [isOpen, setIsOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const coverRef = useRef<HTMLButtonElement>(null);
	const [compact, setCompact] = useState(true);
	const [animationsOff, setAnimationsOff] = useState(false);
	const [currentPageIndex, setCurrentPageIndex] = useState(-1);
	const reducedMotion = useReducedMotion();
	const duration = reducedMotion || animationsOff || compact ? 0 : 0.65;
	const totalPages = pages.length;
	const isAtBeginning = currentPageIndex < 0;
	const isAtEnd = totalPages === 0 || currentPageIndex >= totalPages - 2;

	useEffect(() => {
		const root = rootRef.current;
		if (!root) {
			return;
		}
		const resize = new ResizeObserver(([entry]) => {
			if (entry) {
				setCompact(entry.contentRect.width < 560);
			}
		});
		resize.observe(root);
		const updateMotion = () =>
			setAnimationsOff(
				document.documentElement.dataset.ryuAnimations === "off"
			);
		updateMotion();
		const observer = new MutationObserver(updateMotion);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-ryu-animations"],
		});
		return () => {
			resize.disconnect();
			observer.disconnect();
		};
	}, []);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.altKey || event.ctrlKey || event.metaKey) {
				return;
			}
			if (!["Escape", "ArrowRight", "ArrowLeft"].includes(event.key)) {
				return;
			}
			event.preventDefault();
			if (event.key === "Escape") {
				setIsOpen(false);
				setCurrentPageIndex(-1);
				coverRef.current?.focus();
				return;
			}
			if (event.key === "ArrowRight") {
				setCurrentPageIndex((current) => Math.min(current + 1, totalPages - 2));
			}
			if (event.key === "ArrowLeft") {
				setCurrentPageIndex((current) => Math.max(current - 1, -1));
			}
		};
		const root = rootRef.current;
		root?.addEventListener("keydown", onKeyDown);
		return () => root?.removeEventListener("keydown", onKeyDown);
	}, [isOpen, totalPages]);

	const closeBook = () => {
		setIsOpen(false);
		setCurrentPageIndex(-1);
		coverRef.current?.focus();
	};
	const nextPage = () => {
		setCurrentPageIndex((current) => Math.min(current + 1, totalPages - 2));
	};
	const previousPage = () => {
		setCurrentPageIndex((current) => Math.max(current - 1, -1));
	};

	return (
		<div
			aria-label={`${bookTitle} interactive book`}
			className={cn(
				"relative mx-auto flex min-h-[30rem] w-full max-w-[42rem] items-center justify-center overflow-hidden rounded-2xl border border-border/70 bg-muted/20 px-3 py-10 [perspective:2000px] sm:px-10",
				className
			)}
			data-state={isOpen ? "open" : "closed"}
			data-testid="passport-interactive-book"
			ref={rootRef}
			role="group"
			tabIndex={-1}
		>
			<motion.div
				animate={{ x: isOpen && !compact ? 136 : 0 }}
				className="relative h-[25rem] w-full max-w-[17rem] [transform-style:preserve-3d]"
				initial={{ x: 0 }}
				style={{ transformStyle: "preserve-3d" }}
				transition={{ duration, ease: [0.25, 0, 0, 1] }}
			>
				<div
					aria-hidden="true"
					className="absolute inset-0 flex flex-col items-center justify-center rounded-l-xl border border-border bg-card p-5 text-center text-foreground shadow-sm"
					style={{
						transform: "translateX(-100%)",
						visibility:
							isOpen && !compact && currentPageIndex === -1
								? "visible"
								: "hidden",
					}}
				>
					<BookOpen
						aria-hidden="true"
						className="size-8 text-muted-foreground"
					/>
					<p className="mt-5 font-heading text-3xl tracking-tight">
						{bookTitle}
					</p>
					<p className="mt-3 font-mono text-muted-foreground text-xs">
						{bookAuthor}
					</p>
				</div>
				<motion.button
					animate={{ rotateY: isOpen ? -180 : 0, zIndex: isOpen ? 0 : 50 }}
					aria-hidden={isOpen}
					aria-label={isOpen ? `Close ${bookTitle}` : `Open ${bookTitle}`}
					className="absolute inset-0 z-50 flex h-full w-full origin-left flex-col overflow-hidden rounded-r-xl rounded-l-md border border-foreground/20 bg-foreground p-5 text-left text-background shadow-2xl [backface-visibility:hidden] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
					onClick={() => {
						setIsOpen(true);
						rootRef.current?.focus();
					}}
					ref={coverRef}
					style={{ transformStyle: "preserve-3d" }}
					tabIndex={isOpen ? -1 : 0}
					transition={{ duration, ease: [0.25, 0, 0, 1] }}
					type="button"
				>
					<div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_10%,rgba(255,255,255,0.18),transparent_38%),linear-gradient(135deg,rgba(255,255,255,0.1),transparent_36%)]" />
					<div className="relative flex items-center justify-between font-mono text-[9px] text-background/60 uppercase tracking-[0.18em]">
						<span>{coverKicker}</span>
						<BookOpen aria-hidden="true" className="size-4" />
					</div>
					<div className="relative mt-auto">
						<p className="font-mono text-[10px] text-background/60 uppercase tracking-[0.2em]">
							Ryu service
						</p>
						<h2 className="mt-2 font-heading font-medium text-3xl leading-none tracking-[-0.06em]">
							{bookTitle}
						</h2>
						<p className="mt-4 border-background/25 border-t pt-2 font-mono text-[10px] text-background/70 uppercase tracking-[0.16em]">
							{bookAuthor}
						</p>
					</div>
					<span className="relative mt-8 font-mono text-[9px] text-background/50 uppercase tracking-[0.16em]">
						Click to open · arrows to turn
					</span>
					<span
						aria-hidden="true"
						className="absolute inset-0 flex flex-col items-center justify-center rounded-r-md rounded-l-xl border border-border bg-card p-5 text-center text-foreground [backface-visibility:hidden]"
						style={{ transform: "rotateY(180deg) translateZ(0.5px)" }}
					>
						<BookOpen
							aria-hidden="true"
							className="size-7 text-muted-foreground"
						/>
						<span className="mt-5 font-heading font-medium text-2xl tracking-[-0.04em]">
							{bookTitle}
						</span>
						<span className="mt-2 font-mono text-[9px] text-muted-foreground uppercase tracking-[0.16em]">
							Interactive edition
						</span>
					</span>
				</motion.button>

				<div className="absolute inset-0 z-0 [transform-style:preserve-3d]">
					{pages.map((page, index) => {
						const isFlipped = index <= currentPageIndex;
						return (
							<motion.div
								animate={{
									rotateY: isFlipped ? -180 : 0,
									zIndex: isFlipped ? index + 1 : pages.length - index,
								}}
								className="absolute inset-0 origin-left rounded-r-xl rounded-l-md border border-border bg-card shadow-sm [transform-style:preserve-3d]"
								initial={{ rotateY: 0, zIndex: pages.length - index }}
								key={page.pageNumber}
								style={{
									visibility: compact && isFlipped ? "hidden" : undefined,
								}}
								transition={{ duration, ease: [0.645, 0.045, 0.355, 1] }}
							>
								<button
									aria-hidden={!isOpen || index !== currentPageIndex + 1}
									aria-label={`Read page ${page.pageNumber * 2 - 1}`}
									className="absolute inset-0 flex h-full w-full flex-col overflow-hidden rounded-r-xl rounded-l-md bg-card p-5 text-left text-foreground [backface-visibility:hidden] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
									onClick={nextPage}
									tabIndex={isOpen && index === currentPageIndex + 1 ? 0 : -1}
									type="button"
								>
									<span className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.16em]">
										{String(page.pageNumber * 2 - 1).padStart(2, "0")}
									</span>
									{page.title ? (
										<h3 className="mt-8 font-heading font-medium text-2xl leading-tight tracking-[-0.04em]">
											{page.title}
										</h3>
									) : null}
									<div className="mt-5 font-mono text-muted-foreground text-xs leading-6">
										{page.content}
									</div>
									<span className="mt-auto border-border border-t pt-3 font-mono text-[9px] text-muted-foreground uppercase tracking-[0.14em]">
										Tap the page or press →
									</span>
								</button>
								<button
									aria-hidden={!isOpen || compact || index !== currentPageIndex}
									aria-label={`Read page ${page.pageNumber * 2}`}
									className="absolute inset-0 flex h-full w-full origin-center flex-col overflow-hidden rounded-r-md rounded-l-xl border-border border-r bg-card p-5 text-left text-foreground [backface-visibility:hidden] [transform:rotateY(180deg)] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
									onClick={previousPage}
									style={{
										transform: "rotateY(180deg) translateZ(0.5px)",
										visibility: compact ? "hidden" : undefined,
									}}
									tabIndex={
										isOpen && !compact && index === currentPageIndex ? 0 : -1
									}
									type="button"
								>
									<span className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.16em]">
										{String(page.pageNumber * 2).padStart(2, "0")}
									</span>
									<div className="mt-8 font-mono text-muted-foreground text-xs leading-6">
										{page.backContent ?? (
											<span className="font-heading text-7xl text-foreground/10">
												{String(page.pageNumber * 2).padStart(2, "0")}
											</span>
										)}
									</div>
									<span className="mt-auto border-border border-t pt-3 font-mono text-[9px] text-muted-foreground uppercase tracking-[0.14em]">
										Tap to turn back · press ←
									</span>
								</button>
							</motion.div>
						);
					})}
					<div className="absolute inset-0 -z-10 rounded-r-xl rounded-l-md border border-border bg-card shadow-xl" />
				</div>
			</motion.div>

			<AnimatePresence>
				{isOpen ? (
					<>
						<button
							aria-label={`Close ${bookTitle}`}
							className="absolute top-3 right-3 z-[100] rounded-full border border-border bg-background/80 p-2 text-muted-foreground backdrop-blur transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
							onClick={closeBook}
							type="button"
						>
							<X aria-hidden="true" className="size-4" />
						</button>
						<div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 sm:inset-x-10">
							<button
								aria-label="Previous page"
								className="rounded-full border border-border bg-background/80 p-2 text-muted-foreground backdrop-blur transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
								disabled={isAtBeginning}
								onClick={previousPage}
								type="button"
							>
								<ChevronLeft aria-hidden="true" className="size-4" />
							</button>
							<span
								aria-live="polite"
								className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.14em]"
							>
								{`Page ${Math.min(currentPageIndex + 2, totalPages)} / ${totalPages}`}
							</span>
							<div className="flex items-center gap-2">
								<button
									aria-label="Read the passport again"
									className="rounded-full border border-border bg-background/80 p-2 text-muted-foreground backdrop-blur transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
									onClick={() => setCurrentPageIndex(-1)}
									type="button"
								>
									<RotateCcw aria-hidden="true" className="size-4" />
								</button>
								<button
									aria-label="Next page"
									className="rounded-full border border-border bg-background/80 p-2 text-muted-foreground backdrop-blur transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
									disabled={isAtEnd}
									onClick={nextPage}
									type="button"
								>
									<ChevronRight aria-hidden="true" className="size-4" />
								</button>
							</div>
						</div>
					</>
				) : null}
			</AnimatePresence>
		</div>
	);
}

export function PassportBook() {
	return (
		<InteractiveBook
			bookAuthor="Ryu · identity service"
			bookTitle="Passport"
			coverKicker="Open the vault"
			pages={[
				{
					content: (
						<>
							<p>One profile. Every connected domain.</p>
							<p className="mt-3 text-foreground">
								Passport keeps the session boundary explicit.
							</p>
						</>
					),
					pageNumber: 1,
					title: "A safer identity layer",
				},
				{
					backContent: (
						<p>Credentials stay sealed until an allowed tool needs them.</p>
					),
					content: (
						<>
							<p>Cookies, tokens, and sessions are encrypted at rest.</p>
							<p className="mt-3 text-foreground">
								Never returned to the model.
							</p>
						</>
					),
					pageNumber: 2,
					title: "Sealed by default",
				},
				{
					backContent: (
						<p>
							Manual health checks confirm stored state. Re-import a session
							when its provider login expires.
						</p>
					),
					content: (
						<>
							<p>
								Runtime credentials can use only their assigned identity
								profiles.
							</p>
							<p className="mt-3 text-foreground">
								The agent gets an explicit next step.
							</p>
						</>
					),
					pageNumber: 3,
					title: "Human in the loop",
				},
			]}
		/>
	);
}
