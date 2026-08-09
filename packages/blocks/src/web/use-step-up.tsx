"use client";

import {
	isStepUpRequired,
	type StepUpClient,
	type StepUpMethod,
	type StepUpScope,
	stepUpPromptLine,
} from "@ryu/step-up";
import { Button } from "@ryu/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog";
import { useCallback, useRef, useState } from "react";
import StepUpVerify from "./step-up-verify.tsx";

/**
 * "Confirm it's you" — the prompt that stands between a signed-in session and
 * an action with no undo.
 *
 * Deliberately PRE-flight rather than a retry after a 403: the code is asked for
 * before the delete fires, so a person who cannot produce it has not started
 * anything. The reactive path still exists (the window can lapse between the
 * check and the request), which is what `isStepUpRequired` is for.
 *
 * The body is the shared `StepUpVerify` block — the same slot row, prompt line
 * and full-width button as the device-activation page, so a code entered here
 * reads as the one thing it is rather than as a new screen each time.
 */

interface Pending {
	action: string;
	enrolmentRequired: boolean;
	method: StepUpMethod;
	methods: StepUpMethod[];
	resolve: (verified: boolean) => void;
	scope: StepUpScope;
}

export interface UseStepUpOptions {
	/** The surface's bound client — website cookie, desktop/mobile bearer token. */
	client: StepUpClient;
	/**
	 * Send the user to enrol a second factor. Staff scopes take no emailed
	 * fallback, so this is the only way out of that branch — and every surface
	 * routes differently (Next router, in-app route, deep link).
	 */
	onEnrol2fa: () => void;
}

export function useStepUp({ client, onEnrol2fa }: UseStepUpOptions) {
	const [pending, setPending] = useState<Pending | null>(null);
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	// Guards the auto-submit against firing twice for one complete code, the same
	// way the sign-in 2FA page does.
	const submittedRef = useRef<string | null>(null);

	const close = useCallback((verified: boolean) => {
		setPending((current) => {
			current?.resolve(verified);
			return null;
		});
		setCode("");
		setError(null);
		setIsSubmitting(false);
		submittedRef.current = null;
	}, []);

	/**
	 * Open the prompt and resolve once the user has proven a factor (or given
	 * up). Resolves `true` immediately when a live window already covers the
	 * scope, so a run of admin actions costs one code, not one per click.
	 */
	const prompt = useCallback(
		async (scope: StepUpScope): Promise<boolean> => {
			const status = await client.status(scope);
			if (status.satisfied) {
				return true;
			}
			const methods = status.methods;
			const first = methods[0] ?? "otp";
			// The emailed code has to be requested before it can be typed; the other
			// two are already in the user's hand.
			if (first === "otp" && !status.enrolmentRequired) {
				await client.challenge(scope).catch(() => {
					// Surfaced in the dialog as a failed first attempt rather than as a
					// thrown error that would cancel the action with no explanation.
				});
			}
			return await new Promise<boolean>((resolve) => {
				setCode("");
				setError(null);
				submittedRef.current = null;
				setPending({
					action: status.action,
					enrolmentRequired: status.enrolmentRequired,
					method: first,
					methods,
					resolve,
					scope,
				});
			});
		},
		[client]
	);

	/**
	 * Run `action` behind the prompt, and retry it once if the server asks for a
	 * step-up anyway (the window lapsed in between). Returns `null` when the user
	 * dismissed the prompt — nothing ran, so there is no result to report.
	 */
	const guard = useCallback(
		async <T,>(
			scope: StepUpScope,
			action: () => Promise<T>
		): Promise<T | null> => {
			if (!(await prompt(scope))) {
				return null;
			}
			try {
				const result = await action();
				if (!isStepUpRequired(result)) {
					return result;
				}
			} catch (err) {
				// A thrown failure MIGHT be the gate: the fetch clients surface only
				// the server's human message, which carries no marker. Rather than
				// pattern-match a sentence, ask whether the window is still open — if
				// it is, this failure was something else and belongs to the caller.
				const stillOpen = await client
					.status(scope)
					.then((s) => s.satisfied)
					.catch(() => true);
				if (stillOpen) {
					throw err;
				}
			}
			if (!(await prompt(scope))) {
				return null;
			}
			return await action();
		},
		[client, prompt]
	);

	const submit = useCallback(
		async (value: string) => {
			if (!pending) {
				return;
			}
			const trimmed = value.trim();
			if (!trimmed || submittedRef.current === trimmed) {
				return;
			}
			submittedRef.current = trimmed;
			setIsSubmitting(true);
			setError(null);
			try {
				await client.verify({
					code: trimmed,
					method: pending.method,
					scope: pending.scope,
				});
				close(true);
			} catch (err) {
				setError(err instanceof Error ? err.message : "That code didn't work.");
				setIsSubmitting(false);
				// The slots are full, so nothing more can be typed — empty them so the
				// next attempt can auto-submit too.
				setCode("");
				submittedRef.current = null;
			}
		},
		[client, close, pending]
	);

	const switchMethod = useCallback(
		async (method: StepUpMethod) => {
			if (!pending) {
				return;
			}
			setPending({ ...pending, method });
			setCode("");
			setError(null);
			submittedRef.current = null;
			if (method === "otp") {
				await client.challenge(pending.scope).catch(() => {
					setError("We couldn't send the code. Try again.");
				});
			}
		},
		[client, pending]
	);

	const dialog = (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					close(false);
				}
			}}
			open={pending !== null}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Confirm it&apos;s you</DialogTitle>
					<DialogDescription>
						{pending ? stepUpPromptLine(pending) : null}
					</DialogDescription>
				</DialogHeader>

				{pending?.enrolmentRequired ? (
					// Staff scopes take no emailed fallback, so there is nothing to type
					// here — the only way forward is enrolling a real second factor.
					<div className="space-y-4">
						<p className="text-muted-foreground text-sm">
							Staff actions need two-factor authentication on your account.
						</p>
						<Button
							className="w-full"
							onClick={() => {
								close(false);
								onEnrol2fa();
							}}
							size="lg"
							variant="mono"
						>
							Turn on two-factor
						</Button>
					</div>
				) : null}

				{pending && !pending.enrolmentRequired ? (
					<StepUpVerify
						code={code}
						error={error}
						isSubmitting={isSubmitting}
						method={pending.method}
						onCodeChange={(value) => {
							setCode(value);
							setError(null);
						}}
						onCodeComplete={(value) => {
							if (!isSubmitting) {
								void submit(value);
							}
						}}
						onMethodChange={(method) => void switchMethod(method)}
						onResend={() => void switchMethod("otp")}
						onSubmit={(e) => {
							e.preventDefault();
							void submit(code);
						}}
						otherMethods={pending.methods.filter((m) => m !== pending.method)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);

	return { dialog, guard, prompt };
}
