// apps/desktop/src/components/settings/dialogs/ProviderLoginDialog.tsx
//
// The subscription login flow (ChatGPT / Claude / Copilot), rendered.
//
// Subscription providers are connected by completing a real OAuth flow. Core
// drives pi-ai's own flow modules and streams what they emit; this dialog is the
// surface that was missing — before it, the "Login" button ran an agent-advertised
// ACP method that logs nobody in, and there was nowhere for an authorization URL,
// a device code, or a prompt to appear.
//
// Every flow shape the providers use is handled: an authorization URL to open
// (Claude), a device code to type on a verification page (Copilot), a localhost
// callback that completes on its own (ChatGPT), and prompts in between — free
// text, a pasted code, or a choice.

import { Button } from "@ryu/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog";
import { Input } from "@ryu/ui/components/input";
import { Label } from "@ryu/ui/components/label";
import { toast } from "@ryu/ui/components/sileo";
import { useCallback, useEffect, useRef, useState } from "react";
import { openExternal } from "@/lib/tauri-bridge.ts";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	answerProviderLogin,
	cancelProviderLogin,
	openProviderLoginStream,
	type PiLoginEvent,
	type PiLoginPrompt,
	startProviderLogin,
} from "@/src/lib/api/pi-config.ts";

interface ProviderLoginDialogProps {
	onOpenChange: (open: boolean) => void;
	/** Called once the credential is stored, so the card can flip to Connected. */
	onSuccess: () => void;
	open: boolean;
	providerId: string;
	providerLabel: string;
}

/**
 * Send the user to the provider's page in their REAL browser. This must go
 * through the Tauri shell bridge, not `window.open`: inside the app's webview
 * `window.open` does not reliably reach the system browser, and a silently
 * swallowed authorization link is indistinguishable from a login that does
 * nothing — the exact failure this whole flow exists to end.
 */
function openInBrowser(url: string) {
	Promise.resolve(openExternal(url)).catch(() => undefined);
}

export function ProviderLoginDialog({
	onOpenChange,
	onSuccess,
	open,
	providerId,
	providerLabel,
}: ProviderLoginDialogProps) {
	const activeNode = useActiveNode();
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [authUrl, setAuthUrl] = useState<string | null>(null);
	const [instructions, setInstructions] = useState<string | null>(null);
	const [deviceCode, setDeviceCode] = useState<{
		userCode: string;
		verificationUri: string;
	} | null>(null);
	const [prompt, setPrompt] = useState<{
		id: string;
		prompt: PiLoginPrompt;
	} | null>(null);
	const [answer, setAnswer] = useState("");
	const [status, setStatus] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	// Held in a ref so cleanup can cancel the flow without re-running the effect
	// every time the id lands in state.
	const sessionRef = useRef<string | null>(null);

	const applyEvent = useCallback(
		(event: PiLoginEvent) => {
			switch (event.type) {
				case "auth_url":
					setAuthUrl(event.url ?? null);
					setInstructions(event.instructions ?? null);
					// Opening it immediately is the whole point of the flow: the user
					// asked to log in, so put them in front of the consent screen.
					if (event.url) {
						openInBrowser(event.url);
					}
					break;
				case "device_code":
					setDeviceCode(
						event.verificationUri && event.userCode
							? {
									userCode: event.userCode,
									verificationUri: event.verificationUri,
								}
							: null
					);
					if (event.verificationUri) {
						openInBrowser(event.verificationUri);
					}
					break;
				case "prompt":
					if (event.id && event.prompt) {
						setPrompt({ id: event.id, prompt: event.prompt });
						setAnswer("");
					}
					break;
				case "info":
				case "progress":
					setStatus(event.message ?? null);
					break;
				case "success":
					setDone(true);
					setPrompt(null);
					setStatus(null);
					toast.success({ title: `Connected ${providerLabel}` });
					onSuccess();
					break;
				case "error":
					setError(event.message ?? "The login failed.");
					setPrompt(null);
					break;
				default:
					break;
			}
		},
		[onSuccess, providerLabel]
	);

	// One flow per opening of the dialog. Closing aborts the stream AND cancels
	// the flow server-side — these providers bind fixed localhost callback ports,
	// so a flow left running would make the next attempt fail to bind.
	useEffect(() => {
		if (!open) {
			return;
		}
		const controller = new AbortController();
		let cancelled = false;

		const run = async () => {
			setAuthUrl(null);
			setInstructions(null);
			setDeviceCode(null);
			setPrompt(null);
			setStatus("Starting…");
			setError(null);
			setDone(false);
			try {
				const started = await startProviderLogin(
					toTarget(activeNode),
					providerId
				);
				if (cancelled) {
					// Raced the dialog closing — do not leave the flow running.
					cancelProviderLogin(toTarget(activeNode), started.sessionId).catch(
						() => undefined
					);
					return;
				}
				sessionRef.current = started.sessionId;
				setSessionId(started.sessionId);
				setStatus(null);
				for await (const message of openProviderLoginStream(
					toTarget(activeNode),
					started.sessionId,
					controller.signal
				)) {
					applyEvent(message.data);
				}
			} catch (e) {
				if (!(cancelled || controller.signal.aborted)) {
					setError(
						e instanceof Error ? e.message : "Could not start the login."
					);
				}
			}
		};
		run();

		return () => {
			cancelled = true;
			controller.abort();
			const id = sessionRef.current;
			sessionRef.current = null;
			if (id) {
				cancelProviderLogin(toTarget(activeNode), id).catch(() => undefined);
			}
		};
	}, [open, providerId, activeNode, applyEvent]);

	const submitAnswer = async () => {
		if (!(prompt && sessionId)) {
			return;
		}
		setSubmitting(true);
		try {
			const res = await answerProviderLogin(
				toTarget(activeNode),
				sessionId,
				prompt.id,
				answer
			);
			if (res.accepted) {
				setPrompt(null);
				setStatus("Working…");
			} else {
				setError(res.error ?? "The login did not accept that answer.");
			}
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "The answer could not be sent."
			);
		} finally {
			setSubmitting(false);
		}
	};

	const selectOptions = prompt?.prompt.options ?? [];
	const isSelect = prompt?.prompt.type === "select" && selectOptions.length > 0;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Sign in to {providerLabel}</DialogTitle>
					<DialogDescription>
						Authorize Ryu in your browser. The window stays open until it
						finishes — closing it cancels the sign-in.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					{done ? (
						<p className="text-sm">
							Connected. {providerLabel} is ready to use.
						</p>
					) : null}

					{error ? <p className="text-destructive text-sm">{error}</p> : null}

					{authUrl && !done ? (
						<div className="flex flex-col gap-2">
							<p className="text-muted-foreground text-xs">
								{instructions ??
									"Your browser should have opened. If it didn't, use the button below."}
							</p>
							<Button
								onClick={() => openInBrowser(authUrl)}
								size="sm"
								variant="outline"
							>
								Open the authorization page
							</Button>
						</div>
					) : null}

					{deviceCode && !done ? (
						<div className="flex flex-col gap-2">
							<p className="text-muted-foreground text-xs">
								Enter this code on the verification page:
							</p>
							<p className="font-mono text-lg tracking-widest">
								{deviceCode.userCode}
							</p>
							<Button
								onClick={() => openInBrowser(deviceCode.verificationUri)}
								size="sm"
								variant="outline"
							>
								Open the verification page
							</Button>
						</div>
					) : null}

					{prompt && !done ? (
						<div className="flex flex-col gap-2">
							<Label htmlFor="provider-login-answer">
								{prompt.prompt.message}
							</Label>
							{isSelect ? (
								<div className="flex flex-col gap-2">
									{selectOptions.map((option) => (
										<Button
											disabled={submitting}
											key={option.id}
											onClick={() => {
												setAnswer(option.id);
												// The flow matches on the option id, so send it
												// directly rather than routing through the text box.
												setSubmitting(true);
												answerProviderLogin(
													toTarget(activeNode),
													sessionId ?? "",
													prompt.id,
													option.id
												)
													.then((res) => {
														if (res.accepted) {
															setPrompt(null);
															setStatus("Working…");
														} else {
															setError(res.error ?? "That choice was refused.");
														}
													})
													.catch((e: unknown) => {
														setError(
															e instanceof Error
																? e.message
																: "The choice could not be sent."
														);
													})
													.finally(() => setSubmitting(false));
											}}
											size="sm"
											variant="outline"
										>
											{option.label}
										</Button>
									))}
								</div>
							) : (
								<div className="flex gap-2">
									<Input
										autoFocus
										id="provider-login-answer"
										onChange={(e) => setAnswer(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												e.preventDefault();
												submitAnswer();
											}
										}}
										placeholder={prompt.prompt.placeholder ?? ""}
										value={answer}
									/>
									<Button
										disabled={submitting}
										onClick={submitAnswer}
										size="sm"
									>
										{submitting ? "Sending…" : "Continue"}
									</Button>
								</div>
							)}
						</div>
					) : null}

					{status && !(done || error) ? (
						<p className="text-muted-foreground text-xs">{status}</p>
					) : null}
				</div>

				<DialogFooter>
					<Button
						onClick={() => onOpenChange(false)}
						size="sm"
						variant={done ? "default" : "outline"}
					>
						{done ? "Done" : "Cancel"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
