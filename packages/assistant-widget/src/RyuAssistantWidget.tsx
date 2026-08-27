"use client";

import {
	type BrowserRuntimeStatus,
	createBrowserLocalRuntime,
	DEFAULT_BROWSER_MODEL_ID,
	hasWebGpu,
} from "@ryu/browser-local-ai";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import styles from "./assistant-widget.module.css";
import {
	type AssistantDocReference,
	buildLocalAssistantPrompt,
	deterministicAssistantAnswer,
	findRelevantDocs,
	resolveDocHref,
} from "./docs";
import {
	checkLocalNode,
	type LocalNodeConfig,
	type LocalNodeHealth,
	normalizeNodeUrl,
	runLocalNodeChat,
	validateNodeUrl,
} from "./local-node";

export type AssistantMode = "browser" | "node";

export interface RyuAssistantWidgetProps {
	/** Absolute docs origin for the marketing site; omit on Fumadocs. */
	docsBaseUrl?: string;
	initialMode?: AssistantMode;
	inline?: boolean;
	openOnMount?: boolean;
	showLauncher?: boolean;
}

interface AssistantMessage {
	id: string;
	references?: AssistantDocReference[];
	role: "assistant" | "user";
	source?: string;
	text: string;
}

const NODE_SESSION_KEY = "ryu-assistant-node-v1";
const DEFAULT_NODE_URL = "http://127.0.0.1:7980";

function statusLabel(status: BrowserRuntimeStatus | undefined): string {
	if (!status || status.status === "not-prepared") {
		return "Not downloaded";
	}
	if (status.status === "preparing") {
		return status.progress == null
			? "Preparing"
			: `Downloading ${Math.round(status.progress)}%`;
	}
	if (status.status === "ready") {
		return "Ready in this browser";
	}
	return "Could not prepare";
}

function readStoredNode(): { baseUrl: string; token: string | null } | null {
	try {
		const raw = sessionStorage.getItem(NODE_SESSION_KEY);
		if (!raw) {
			return null;
		}
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== "object") {
			return null;
		}
		const record = value as Record<string, unknown>;
		if (typeof record.baseUrl !== "string") {
			return null;
		}
		return {
			baseUrl: normalizeNodeUrl(record.baseUrl),
			token: typeof record.token === "string" ? record.token : null,
		};
	} catch {
		return null;
	}
}

function storeNode(config: LocalNodeConfig): void {
	try {
		sessionStorage.setItem(NODE_SESSION_KEY, JSON.stringify(config));
	} catch {
		// Private browsing can deny session storage; in-memory use still works.
	}
}

function clearStoredNode(): void {
	try {
		sessionStorage.removeItem(NODE_SESSION_KEY);
	} catch {
		// Nothing to clear when storage is unavailable.
	}
}

function nodeSummary(health: LocalNodeHealth): string {
	const version = health.version ? `Core ${health.version}` : "Core online";
	return health.channel ? `${version} · ${health.channel}` : version;
}

function messageId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function usableBrowserAnswer(answer: string, question: string): boolean {
	const normalized = answer.trim().toLowerCase();
	if (!normalized || normalized.length > 6000) {
		return false;
	}
	const roleLabels = normalized.match(/\b(system|user|assistant):/g) ?? [];
	if (roleLabels.length > 1 || normalized.includes("public context:")) {
		return false;
	}
	return normalized !== question.trim().toLowerCase();
}

export function RyuAssistantWidget({
	docsBaseUrl,
	initialMode = "browser",
	inline = false,
	openOnMount = false,
	showLauncher = true,
}: RyuAssistantWidgetProps) {
	const [open, setOpen] = useState(openOnMount || inline);
	const [mode, setMode] = useState<AssistantMode>(initialMode);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [runtimeStatus, setRuntimeStatus] = useState<BrowserRuntimeStatus>();
	const [nodeUrl, setNodeUrl] = useState(DEFAULT_NODE_URL);
	const [nodeToken, setNodeToken] = useState("");
	const [allowRemote, setAllowRemote] = useState(false);
	const [rememberNode, setRememberNode] = useState(false);
	const [nodeConnected, setNodeConnected] = useState(false);
	const [nodeHealth, setNodeHealth] = useState<LocalNodeHealth>();
	const [messages, setMessages] = useState<AssistantMessage[]>([
		{
			id: "welcome",
			role: "assistant",
			source: "Ryu local assistant",
			text: "Ask about Ryu, the SDK, or these docs. Choose browser-local mode for a model that runs in this tab, or connect a running Ryu Core node.",
		},
	]);
	const [runtime] = useState(() =>
		createBrowserLocalRuntime({ onStatus: setRuntimeStatus })
	);
	const messagesRef = useRef<HTMLDivElement>(null);

	const modelReady = runtimeStatus?.status === "ready";

	useEffect(() => runtime.subscribe(setRuntimeStatus), [runtime]);

	useEffect(() => {
		const container = messagesRef.current;
		if (container) {
			container.scrollTo({ behavior: "smooth", top: container.scrollHeight });
		}
	}, [messages]);

	useEffect(() => {
		const stored = readStoredNode();
		if (!stored) {
			return;
		}
		setNodeUrl(stored.baseUrl);
		setNodeToken(stored.token ?? "");
		setRememberNode(true);
		setNotice("A node address is ready to test in this tab.");
	}, []);

	const openAssistant = () => {
		setOpen(true);
		setError(null);
	};

	const prepareBrowserModel = async () => {
		setError(null);
		setNotice(null);
		setBusy(true);
		try {
			await runtime.prepare(DEFAULT_BROWSER_MODEL_ID);
			setNotice(
				"The model is cached in this browser. Questions stay in this tab."
			);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The browser model could not load."
			);
		} finally {
			setBusy(false);
		}
	};

	const connectNode = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError(null);
		setNotice(null);
		setBusy(true);
		try {
			const baseUrl = validateNodeUrl(nodeUrl, allowRemote);
			const config: LocalNodeConfig = {
				baseUrl,
				token: nodeToken.trim() || null,
			};
			const health = await checkLocalNode(config);
			setNodeUrl(baseUrl);
			setNodeHealth(health);
			setNodeConnected(true);
			if (rememberNode) {
				storeNode(config);
			}
			setNotice(`${nodeSummary(health)} · direct browser connection`);
		} catch (cause) {
			setNodeConnected(false);
			setNodeHealth(undefined);
			setError(
				cause instanceof Error
					? cause.message
					: "The node could not be connected."
			);
		} finally {
			setBusy(false);
		}
	};

	const disconnectNode = () => {
		setNodeConnected(false);
		setNodeHealth(undefined);
		setNodeToken("");
		setRememberNode(false);
		clearStoredNode();
		setNotice("The local node token was removed from this tab.");
	};

	const submitQuestion = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const question = draft.trim();
		if (!question || busy) {
			return;
		}
		setError(null);
		setNotice(null);
		setDraft("");
		const references = findRelevantDocs(question);
		const assistantId = messageId("answer");
		setMessages((current) => [
			...current,
			{ id: messageId("question"), role: "user", text: question },
			{
				id: assistantId,
				role: "assistant",
				text: "",
				references,
				source:
					mode === "browser" ? "Browser-local model" : "Your Ryu Core node",
			},
		]);
		setBusy(true);

		try {
			if (mode === "browser") {
				if (!modelReady) {
					await runtime.prepare(DEFAULT_BROWSER_MODEL_ID);
				}
				const result = await runtime.generate({
					messages: [
						{
							content: buildLocalAssistantPrompt(question, references),
							role: "system",
						},
						{ content: question, role: "user" },
					],
					modelId: DEFAULT_BROWSER_MODEL_ID,
				});
				const generatedAnswer = result.text.trim();
				const modelAnswerIsUsable = usableBrowserAnswer(
					generatedAnswer,
					question
				);
				const answer = modelAnswerIsUsable
					? generatedAnswer
					: deterministicAssistantAnswer(question, references);
				setMessages((current) =>
					current.map((message) =>
						message.id === assistantId ? { ...message, text: answer } : message
					)
				);
				setNotice(
					modelAnswerIsUsable
						? "Answered locally · no prompt was sent to Ryu servers."
						: "Answered locally with the cached model and public-doc grounding."
				);
				return;
			}

			if (!nodeConnected) {
				throw new Error("Connect a local Ryu node before sending a question.");
			}
			const config: LocalNodeConfig = {
				baseUrl: nodeUrl,
				token: nodeToken.trim() || null,
			};
			let streamedAnswer = "";
			const answer = await runLocalNodeChat(
				config,
				[
					{
						content: buildLocalAssistantPrompt(question, references),
						role: "system",
					},
					{ content: question, role: "user" },
				],
				{
					onDelta(delta) {
						streamedAnswer += delta;
						setMessages((current) =>
							current.map((message) =>
								message.id === assistantId
									? { ...message, text: streamedAnswer }
									: message
							)
						);
					},
				}
			);
			setMessages((current) =>
				current.map((message) =>
					message.id === assistantId
						? {
								...message,
								text:
									answer || deterministicAssistantAnswer(question, references),
							}
						: message
				)
			);
			setNotice(
				"Answered by your local Ryu Core node · this visitor turn was not persisted."
			);
		} catch (cause) {
			setMessages((current) =>
				current.filter((message) => message.id !== assistantId)
			);
			setError(
				cause instanceof Error
					? cause.message
					: "The assistant could not answer."
			);
		} finally {
			setBusy(false);
		}
	};

	const browserStatus =
		runtimeStatus ?? runtime.getStatus(DEFAULT_BROWSER_MODEL_ID);
	const canAsk = mode === "browser" ? modelReady : nodeConnected;
	const shellClass = inline ? styles.inlineShell : styles.shell;
	const panelClass = inline
		? `${styles.panel} ${styles.inlinePanel}`
		: styles.panel;

	if (!open && showLauncher) {
		return (
			<div className={shellClass}>
				<button
					aria-expanded={false}
					aria-label="Open Ask Ryu"
					className={styles.launcher}
					onClick={openAssistant}
					type="button"
				>
					<span aria-hidden="true" className={styles.launcherMark}>
						R/
					</span>
					Ask Ryu
				</button>
			</div>
		);
	}

	if (!(open || showLauncher)) {
		return null;
	}

	return (
		<div className={shellClass}>
			<section aria-label="Ask Ryu assistant" className={panelClass}>
				<header className={styles.panelHeader}>
					<div>
						<span className={styles.eyebrow}>Ryu / local assistant</span>
						<h2 className={styles.title}>Ask Ryu</h2>
						<p className={styles.subtitle}>
							A small proof of the same SDK idea: choose where inference runs.
						</p>
					</div>
					{inline ? null : (
						<button
							aria-label="Close assistant"
							className={styles.closeButton}
							onClick={() => setOpen(false)}
							type="button"
						>
							×
						</button>
					)}
				</header>

				<div
					aria-label="Assistant runtime"
					className={styles.modeTabs}
					role="tablist"
				>
					<button
						aria-selected={mode === "browser"}
						className={`${styles.modeButton} ${mode === "browser" ? styles.modeButtonActive : ""}`}
						onClick={() => {
							setMode("browser");
							setError(null);
							setNotice(null);
						}}
						role="tab"
						type="button"
					>
						<span className={styles.modeLabel}>This browser</span>
						<span className={styles.modeDescription}>
							Download once · private
						</span>
					</button>
					<button
						aria-selected={mode === "node"}
						className={`${styles.modeButton} ${mode === "node" ? styles.modeButtonActive : ""}`}
						onClick={() => {
							setMode("node");
							setError(null);
							setNotice(null);
						}}
						role="tab"
						type="button"
					>
						<span className={styles.modeLabel}>My local node</span>
						<span className={styles.modeDescription}>
							Connect Core · governed
						</span>
					</button>
				</div>

				<div className={styles.modeBody}>
					{mode === "browser" ? (
						<div className={styles.localCard}>
							<div className={styles.cardHeading}>
								<h3 className={styles.cardTitle}>Run in this visitor's tab</h3>
								<span
									className={`${styles.status} ${browserStatus?.status === "ready" ? styles.statusReady : browserStatus?.status === "preparing" ? styles.statusWorking : ""}`}
								>
									<span aria-hidden="true" className={styles.statusDot} />
									{statusLabel(browserStatus)}
								</span>
							</div>
							<p className={styles.cardCopy}>
								Transformers.js uses WebGPU when available and falls back to
								WASM. The model is cached by this browser; no registration or
								server prompt is required.
							</p>
							<div className={styles.modelRow}>
								<span className={styles.modelName}>SmolLM2 135M</span>
								<span className={styles.modelMeta}>
									{hasWebGpu() ? "WebGPU → WASM" : "WASM runtime"} · browser
									cache
								</span>
							</div>
							{browserStatus?.status === "preparing" ? (
								<div
									aria-label="Model download progress"
									aria-valuemax={100}
									aria-valuemin={0}
									aria-valuenow={browserStatus.progress ?? 0}
									className={styles.progressTrack}
									role="progressbar"
								>
									<div
										className={styles.progressBar}
										style={{ width: `${browserStatus.progress ?? 7}%` }}
									/>
								</div>
							) : null}
							<button
								className={styles.primaryButton}
								disabled={busy || modelReady}
								onClick={() => void prepareBrowserModel()}
								type="button"
							>
								{modelReady
									? "Model ready"
									: busy
										? "Preparing…"
										: "Download local model"}
							</button>
						</div>
					) : nodeConnected ? (
						<div className={styles.nodeCard}>
							<div className={styles.cardHeading}>
								<h3 className={styles.cardTitle}>Connected to your node</h3>
								<span className={`${styles.status} ${styles.statusConnected}`}>
									<span aria-hidden="true" className={styles.statusDot} />
									Online
								</span>
							</div>
							<div className={styles.nodeSummary}>
								<span className={styles.modelName}>
									{nodeHealth ? nodeSummary(nodeHealth) : "Ryu Core"}
								</span>
								<span className={styles.modelMeta}>{nodeUrl}</span>
							</div>
							<p className={styles.cardCopy}>
								Questions go directly from this tab to Core. Visitor turns use{" "}
								<code>persist: false</code> and do not enter the node's chat
								history.
							</p>
							<button
								className={styles.ghostButton}
								onClick={disconnectNode}
								type="button"
							>
								Disconnect this tab
							</button>
						</div>
					) : (
						<form
							className={styles.nodeCard}
							onSubmit={(event) => void connectNode(event)}
						>
							<div className={styles.cardHeading}>
								<h3 className={styles.cardTitle}>Connect a running Ryu Core</h3>
								<span className={styles.status}>
									<span aria-hidden="true" className={styles.statusDot} />
									Not connected
								</span>
							</div>
							<p className={styles.cardCopy}>
								This is the second bridge: the site never proxies your node
								credential. It calls the address you approve with the token you
								provide.
							</p>
							<div className={styles.formStack}>
								<label className={styles.fieldLabel}>
									Node address
									<input
										aria-label="Local Ryu node address"
										className={styles.input}
										onChange={(event) => setNodeUrl(event.target.value)}
										placeholder={DEFAULT_NODE_URL}
										spellCheck={false}
										type="url"
										value={nodeUrl}
									/>
								</label>
								<label className={styles.fieldLabel}>
									Node token{" "}
									<span>(optional only for an unauthenticated dev node)</span>
									<input
										aria-label="Local Ryu node token"
										autoComplete="off"
										className={styles.input}
										onChange={(event) => setNodeToken(event.target.value)}
										placeholder="Paste the node token"
										type="password"
										value={nodeToken}
									/>
								</label>
								<label className={styles.checkRow}>
									<input
										checked={allowRemote}
										onChange={(event) => setAllowRemote(event.target.checked)}
										type="checkbox"
									/>
									<span>I trust this remote/LAN node and its network.</span>
								</label>
								<label className={styles.checkRow}>
									<input
										checked={rememberNode}
										onChange={(event) => setRememberNode(event.target.checked)}
										type="checkbox"
									/>
									<span>Remember this connection for this tab only.</span>
								</label>
								<div className={styles.formActions}>
									<button
										className={styles.primaryButton}
										disabled={busy}
										type="submit"
									>
										{busy ? "Testing…" : "Test & connect"}
									</button>
								</div>
							</div>
							<p className={styles.securityNote}>
								The token stays in memory unless you choose this tab's session
								storage. Core must allow this site origin in{" "}
								<code>RYU_CORS_ORIGINS</code> for a hosted connection.
							</p>
						</form>
					)}
					{notice ? <p className={styles.notice}>{notice}</p> : null}
					{error ? <p className={styles.error}>{error}</p> : null}
				</div>

				<div aria-live="polite" className={styles.messages} ref={messagesRef}>
					{messages.length === 0 ? (
						<p className={styles.emptyState}>
							Your local conversation will appear here.
						</p>
					) : (
						messages.map((message) => (
							<article
								className={`${styles.message} ${message.role === "user" ? styles.messageUser : styles.messageAssistant}`}
								key={message.id}
							>
								{message.source ? (
									<span className={styles.messageMeta}>{message.source}</span>
								) : null}
								{message.text ||
									(busy && message.role === "assistant"
										? "Thinking locally…"
										: "")}
								{message.references && message.references.length > 0 ? (
									<div className={styles.sourceList}>
										{message.references.map((reference) => (
											<a
												className={styles.sourceLink}
												href={resolveDocHref(docsBaseUrl, reference.href)}
												key={reference.href}
											>
												{reference.title} ↗
											</a>
										))}
									</div>
								) : null}
							</article>
						))
					)}
				</div>

				<form
					className={styles.composer}
					onSubmit={(event) => void submitQuestion(event)}
				>
					<textarea
						aria-label="Ask Ryu a question"
						className={styles.textarea}
						disabled={busy || !canAsk}
						onChange={(event) => setDraft(event.target.value)}
						placeholder={
							mode === "browser"
								? modelReady
									? "Ask about Ryu or this documentation…"
									: "Download the browser model to start…"
								: nodeConnected
									? "Ask your local node about Ryu…"
									: "Connect your local node to start…"
						}
						value={draft}
					/>
					<button
						className={styles.sendButton}
						disabled={busy || !canAsk || !draft.trim()}
						type="submit"
					>
						{busy ? "…" : "Ask"}
					</button>
				</form>
			</section>
		</div>
	);
}
