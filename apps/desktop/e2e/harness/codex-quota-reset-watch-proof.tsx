import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

type CheckState = "baseline" | "unchanged" | "changed" | "outage";

const SOURCE_URL = "https://www.willcodexquotareset.com/";

const states: Record<
	CheckState,
	{ body: string; label: string; tone: string; title: string }
> = {
	baseline: {
		body: "The current snapshot is stored. No notification is sent for the first check.",
		label: "BASELINE",
		tone: "#7dd3fc",
		title: "Baseline recorded",
	},
	unchanged: {
		body: "The normalized forecast matches the last snapshot. The 30-minute check stays quiet.",
		label: "NO CHANGE",
		tone: "#94a3b8",
		title: "No alert",
	},
	changed: {
		body: "A monitored signal changed. The agent reports old/new values and sends notify.desktop.",
		label: "MATERIAL CHANGE",
		tone: "#43d39e",
		title: "Desktop notification sent",
	},
	outage: {
		body: "The public source could not be verified. The agent alerts once, keeps the last good snapshot, and alerts again on recovery.",
		label: "SOURCE OUTAGE",
		tone: "#fbbf24",
		title: "Verification needed",
	},
};

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div
			style={{
				background: "#111923",
				border: "1px solid #223040",
				borderRadius: 14,
				padding: "15px 16px",
			}}
		>
			<div
				style={{
					color: "#8292a5",
					fontSize: 11,
					fontWeight: 700,
					letterSpacing: "0.12em",
					textTransform: "uppercase",
				}}
			>
				{label}
			</div>
			<div
				style={{
					color: "#eef5ff",
					fontSize: 22,
					fontWeight: 750,
					letterSpacing: "-0.03em",
					marginTop: 7,
				}}
			>
				{value}
			</div>
		</div>
	);
}

function App() {
	const [checkState, setCheckState] = useState<CheckState>("changed");
	const activeState = states[checkState];
	const stateButtons = useMemo(
		() =>
			[
				["baseline", "First check"],
				["unchanged", "No change"],
				["changed", "Forecast changed"],
				["outage", "Source outage"],
			] as const,
		[]
	);

	return (
		<main
			style={{
				background: "#090d12",
				boxSizing: "border-box",
				color: "#eef5ff",
				fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
				minHeight: "100vh",
				padding: "38px 24px 56px",
			}}
		>
			<div style={{ margin: "0 auto", maxWidth: 1040 }}>
				<header>
					<div style={{ alignItems: "center", display: "flex", gap: 13 }}>
						<div
							aria-hidden="true"
							style={{
								alignItems: "center",
								background: "#153c32",
								border: "1px solid #43d39e",
								borderRadius: 13,
								display: "flex",
								fontSize: 22,
								height: 46,
								justifyContent: "center",
								width: 46,
							}}
						>
							↗
						</div>
						<div>
							<div
								style={{
									color: "#43d39e",
									fontSize: 12,
									fontWeight: 750,
									letterSpacing: "0.14em",
								}}
							>
								VERIFIED REACT ARTIFACT
							</div>
							<h1
								style={{
									fontSize: 34,
									letterSpacing: "-0.045em",
									margin: "5px 0 0",
								}}
							>
								Codex Quota Reset Watch
							</h1>
						</div>
					</div>
					<p
						style={{
							color: "#aebdcd",
							fontSize: 16,
							lineHeight: 1.6,
							margin: "20px 0 26px",
							maxWidth: 790,
						}}
					>
						A first-party marketplace agent that checks the public reset
						forecast every 30 minutes, compares it with its last snapshot, and
						tells the user only when something meaningful changes.
					</p>
				</header>

				<section
					aria-label="Template summary"
					style={{
						display: "grid",
						gap: 10,
						gridTemplateColumns: "repeat(4, 1fr)",
					}}
				>
					<Metric label="Marketplace id" value="ryu/codex-quota-reset-watch" />
					<Metric label="Cadence" value="Every 30m" />
					<Metric label="Tools" value="3 built-ins" />
					<Metric label="Approval" value="Off" />
				</section>

				<section
					aria-label="Monitoring flow"
					style={{
						background: "#111923",
						border: "1px solid #223040",
						borderRadius: 18,
						marginTop: 18,
						padding: 20,
					}}
				>
					<div
						style={{
							color: "#8292a5",
							fontSize: 11,
							fontWeight: 700,
							letterSpacing: "0.14em",
							textTransform: "uppercase",
						}}
					>
						Monitoring loop
					</div>
					<div
						style={{
							display: "grid",
							gap: 12,
							gridTemplateColumns: "repeat(4, 1fr)",
							marginTop: 14,
						}}
					>
						{[
							["01", "Fetch", "web_fetch.get", "Read the public page."],
							[
								"02",
								"Normalize",
								"forecast fields",
								"Ignore the moving checked time.",
							],
							["03", "Compare", "memory.search", "Match the latest snapshot."],
							[
								"04",
								"Alert",
								"notify.desktop",
								"Tell the user on a real change.",
							],
						].map(([number, title, tool, detail]) => (
							<div
								key={number}
								style={{
									background: "#0d141c",
									border: "1px solid #223040",
									borderRadius: 14,
									padding: 14,
								}}
							>
								<div
									style={{ color: "#43d39e", fontSize: 12, fontWeight: 750 }}
								>
									{number}
								</div>
								<div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>
									{title}
								</div>
								<code style={{ color: "#7dd3fc", fontSize: 12 }}>{tool}</code>
								<div
									style={{
										color: "#aebdcd",
										fontSize: 12,
										lineHeight: 1.5,
										marginTop: 8,
									}}
								>
									{detail}
								</div>
							</div>
						))}
					</div>
				</section>

				<section
					aria-label="Observed source"
					style={{
						display: "grid",
						gap: 18,
						gridTemplateColumns: "1.1fr 0.9fr",
						marginTop: 18,
					}}
				>
					<div
						style={{
							background: "#111923",
							border: "1px solid #223040",
							borderRadius: 18,
							padding: 20,
						}}
					>
						<div
							style={{
								color: "#8292a5",
								fontSize: 11,
								fontWeight: 700,
								letterSpacing: "0.14em",
								textTransform: "uppercase",
							}}
						>
							Live source snapshot
						</div>
						<a
							href={SOURCE_URL}
							rel="noopener"
							style={{
								color: "#7dd3fc",
								display: "inline-block",
								fontSize: 15,
								marginTop: 13,
							}}
							target="_blank"
						>
							willcodexquotareset.com ↗
						</a>
						<div
							style={{
								alignItems: "end",
								display: "flex",
								gap: 16,
								marginTop: 20,
							}}
						>
							<div>
								<div
									style={{
										color: "#8292a5",
										fontSize: 11,
										letterSpacing: "0.1em",
										textTransform: "uppercase",
									}}
								>
									Reset likelihood
								</div>
								<div
									style={{
										color: "#43d39e",
										fontSize: 48,
										fontWeight: 800,
										letterSpacing: "-0.06em",
										lineHeight: 1,
									}}
								>
									36%
								</div>
							</div>
							<div style={{ borderLeft: "1px solid #334155", paddingLeft: 16 }}>
								<div
									style={{ color: "#eef5ff", fontSize: 17, fontWeight: 700 }}
								>
									Do not force it.
								</div>
								<div
									style={{
										color: "#aebdcd",
										fontSize: 12,
										lineHeight: 1.5,
										marginTop: 5,
									}}
								>
									Observed public guidance · last checked 03:48 PM
								</div>
							</div>
						</div>
						<div
							style={{
								borderTop: "1px solid #223040",
								color: "#aebdcd",
								fontSize: 12,
								lineHeight: 1.55,
								marginTop: 20,
								paddingTop: 14,
							}}
						>
							The watcher preserves the site's caveat: this is a public
							forecast, not an official OpenAI reset signal.
						</div>
					</div>

					<div
						style={{
							background: "#111923",
							border: "1px solid #223040",
							borderRadius: 18,
							padding: 20,
						}}
					>
						<div
							style={{
								color: "#8292a5",
								fontSize: 11,
								fontWeight: 700,
								letterSpacing: "0.14em",
								textTransform: "uppercase",
							}}
						>
							Alert policy preview
						</div>
						<div
							style={{
								color: "#eef5ff",
								fontSize: 17,
								fontWeight: 700,
								marginTop: 13,
							}}
						>
							Simulate the next check
						</div>
						<div
							style={{
								display: "flex",
								flexWrap: "wrap",
								gap: 7,
								marginTop: 13,
							}}
						>
							{stateButtons.map(([value, label]) => (
								<button
									key={value}
									onClick={() => setCheckState(value)}
									style={{
										background: checkState === value ? "#153c32" : "#0d141c",
										border: `1px solid ${checkState === value ? "#43d39e" : "#334155"}`,
										borderRadius: 999,
										color: checkState === value ? "#b9ffe2" : "#aebdcd",
										cursor: "pointer",
										fontSize: 12,
										padding: "7px 10px",
									}}
									type="button"
								>
									{label}
								</button>
							))}
						</div>
						<div
							data-testid="alert-policy-result"
							style={{
								borderLeft: `3px solid ${activeState.tone}`,
								marginTop: 20,
								paddingLeft: 13,
							}}
						>
							<div
								style={{
									color: activeState.tone,
									fontSize: 11,
									fontWeight: 750,
									letterSpacing: "0.12em",
								}}
							>
								{activeState.label}
							</div>
							<div style={{ fontSize: 18, fontWeight: 750, marginTop: 6 }}>
								{activeState.title}
							</div>
							<div
								style={{
									color: "#aebdcd",
									fontSize: 13,
									lineHeight: 1.55,
									marginTop: 7,
								}}
							>
								{activeState.body}
							</div>
						</div>
					</div>
				</section>

				<section
					aria-label="Verification evidence"
					data-testid="verification-evidence"
					style={{
						background: "#111923",
						border: "1px solid #223040",
						borderRadius: 18,
						marginTop: 18,
						padding: 20,
					}}
				>
					<div
						style={{
							alignItems: "center",
							display: "flex",
							justifyContent: "space-between",
							gap: 12,
						}}
					>
						<div
							style={{
								color: "#8292a5",
								fontSize: 11,
								fontWeight: 700,
								letterSpacing: "0.14em",
								textTransform: "uppercase",
							}}
						>
							Verification evidence
						</div>
						<span
							data-testid="proof-status"
							style={{
								background: "#153c32",
								border: "1px solid #43d39e",
								borderRadius: 999,
								color: "#b9ffe2",
								fontSize: 11,
								fontWeight: 750,
								padding: "6px 10px",
							}}
						>
							READY
						</span>
					</div>
					<ul
						style={{
							color: "#aebdcd",
							display: "grid",
							gap: 10,
							lineHeight: 1.5,
							listStyle: "none",
							margin: "16px 0 0",
							padding: 0,
						}}
					>
						<li>
							✓ First-party seed: <code>ryu/codex-quota-reset-watch</code>
						</li>
						<li>
							✓ Read-only fetch + durable snapshot memory + desktop notification
						</li>
						<li>✓ One enabled background schedule: every 30 minutes</li>
						<li>
							✓ Baseline, unchanged, change, outage, and recovery paths are
							explicit
						</li>
					</ul>
				</section>

				<footer
					style={{
						color: "#6f8297",
						fontSize: 12,
						lineHeight: 1.6,
						marginTop: 18,
					}}
				>
					Forecast source observed in the browser before this proof was
					rendered. The agent never claims an official OpenAI quota reset.
				</footer>
			</div>
		</main>
	);
}

type ProofRuntime = typeof globalThis & {
	__codexQuotaResetWatchRoot?: ReturnType<typeof createRoot>;
};

const proofRootElement = document.getElementById("root");
if (!proofRootElement) {
	throw new Error("Codex Quota Reset Watch proof root is missing");
}

const proofRuntime = globalThis as ProofRuntime;
const proofRoot =
	proofRuntime.__codexQuotaResetWatchRoot ?? createRoot(proofRootElement);
proofRuntime.__codexQuotaResetWatchRoot = proofRoot;
proofRoot.render(<App />);
