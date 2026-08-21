import { AppleHelloEffect } from "@ryu/ui/components/apple-hello-effect";
import { Button } from "@ryu/ui/components/button";
import { Logo as GhostOrb } from "@ryu/ui/components/logo";
import { PageHeader } from "@ryu/ui/components/page-header";
import { StaggerReveal } from "@ryu/ui/components/stagger-reveal";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const SIGNATURE_TO_HELLO_DELAY_MS = 5000;
const HELLO_LANGUAGE_INTERVAL_MS = 2400;

const HELLO_LANGUAGES = [
	{ language: "English", text: "hello" },
	{ language: "Hindi", text: "नमस्ते" },
	{ language: "Spanish", text: "hola" },
	{ language: "Vietnamese", text: "xin chào" },
] as const;

function RyuWelcomeWordmark({ reducedMotion }: { reducedMotion: boolean }) {
	return (
		<span
			className="ryu-welcome-wordmark text-foreground"
			data-reduced-motion={reducedMotion}
		>
			<span>Ryu</span>
			{reducedMotion ? null : (
				<span aria-hidden="true" className="ryu-welcome-wordmark__sweep">
					Ryu
				</span>
			)}
		</span>
	);
}

interface WelcomeStepProps {
	onContinue: () => void;
}

export function WelcomeStep({ onContinue }: WelcomeStepProps) {
	const [helloStarted, setHelloStarted] = useState(false);
	const [helloIndex, setHelloIndex] = useState(0);
	const reducedMotion = useReducedMotion();

	useEffect(() => {
		const timeout = window.setTimeout(
			() => setHelloStarted(true),
			SIGNATURE_TO_HELLO_DELAY_MS
		);

		return () => window.clearTimeout(timeout);
	}, []);

	useEffect(() => {
		if (!helloStarted) {
			return;
		}

		const interval = window.setInterval(() => {
			setHelloIndex((current) => (current + 1) % HELLO_LANGUAGES.length);
		}, HELLO_LANGUAGE_INTERVAL_MS);

		return () => window.clearInterval(interval);
	}, [helloStarted]);

	const greeting = HELLO_LANGUAGES[helloIndex];
	const isCanonicalHello = greeting.language === "English";

	return (
		<div className="scroll-fade h-full w-full overflow-y-auto">
			<div
				className="flex min-h-full w-full flex-col items-center justify-center gap-8 p-8"
				data-tauri-drag-region="true"
			>
				<StaggerReveal>
					<div className="shrink-0">
						<GhostOrb size="50px" variant="outline" />
					</div>
				</StaggerReveal>

				<div className="flex min-h-44 w-full max-w-md flex-col items-center justify-center gap-7">
					<div
						aria-live="polite"
						className="flex h-24 w-full items-center justify-center"
						data-language={helloStarted ? greeting.language : undefined}
						data-testid="apple-hello-loop"
						role="status"
					>
						<AnimatePresence initial={false} mode="wait">
							{helloStarted ? (
								<motion.div
									animate={{ opacity: 1, y: 0 }}
									className="flex h-24 items-center justify-center"
									exit={{ opacity: 0, y: -10 }}
									initial={{ opacity: 0, y: 10 }}
									key={`hello-${greeting.language}`}
									transition={{
										duration: reducedMotion ? 0 : 0.35,
										ease: "easeOut",
									}}
								>
									<AppleHelloEffect
										className="flex h-24 items-center justify-center text-5xl text-foreground sm:text-6xl"
										durationScale={reducedMotion ? 0 : 0.7}
										text={isCanonicalHello ? undefined : greeting.text}
									/>
								</motion.div>
							) : (
								<motion.div
									animate={{ opacity: 1, y: 0 }}
									className="flex h-24 items-center justify-center"
									exit={{ opacity: 0, y: -10 }}
									initial={{ opacity: 1, y: 0 }}
									key="welcome"
								>
									<PageHeader
										className="text-center"
										stagger={false}
										title={
											<span className="inline-flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 leading-none">
												<span>Welcome to</span>
												<span
													aria-hidden="true"
													className="inline-flex h-[1.55em] items-center"
												>
													<RyuWelcomeWordmark
														reducedMotion={Boolean(reducedMotion)}
													/>
												</span>
												<span className="sr-only">Ryu</span>
											</span>
										}
										titleClassName="text-2xl sm:text-3xl"
									/>
								</motion.div>
							)}
						</AnimatePresence>
					</div>

					<div className="flex h-14 items-center justify-center">
						{helloStarted ? (
							<motion.div
								animate={{ opacity: 1, y: 0 }}
								initial={{ opacity: 0, y: 8 }}
								transition={{
									duration: reducedMotion ? 0 : 0.4,
									ease: "easeOut",
								}}
							>
								<Button
									aria-label="Continue to Ryu"
									data-testid="onboarding-continue"
									onClick={onContinue}
									size="lg"
									variant="mono"
								>
									Continue to Ryu
								</Button>
							</motion.div>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
}
