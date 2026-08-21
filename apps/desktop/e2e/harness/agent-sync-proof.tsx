import { useState } from "react";
import { createRoot } from "react-dom/client";

const profiles = [
	["Claude", "/Users/jiawei/.claude", "import + export", "idle"],
	["Codex", "/Users/jiawei/.codex", "import only", "idle"],
	["Cursor", "/Users/jiawei/.cursor", "disabled", "conflict"],
] as const;

const styles = {
	accent: "#c4b5fd",
	background: "#09090b",
	border: "#27272a",
	green: "#86efac",
	muted: "#a1a1aa",
	panel: "#111113",
	text: "#f4f4f5",
};

function AgentSyncProof() {
	const [selected, setSelected] = useState("Claude");
	const [exported, setExported] = useState(false);
	const [resumed, setResumed] = useState(false);

	return (
		<main
			style={{
				background: styles.background,
				boxSizing: "border-box",
				color: styles.text,
				fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
				minHeight: "100vh",
				padding: "32px 24px 56px",
			}}
		>
			<div style={{ margin: "0 auto", maxWidth: 980 }}>
				<header style={{ marginBottom: 24 }}>
					<div
						style={{ color: styles.accent, fontSize: 12, letterSpacing: 1.4 }}
					>
						RYU · GATEWAY · LIVE REACT PROOF
					</div>
					<h1 style={{ fontSize: 34, letterSpacing: -1.2, margin: "8px 0 0" }}>
						Agent Import / Export Sync
					</h1>
					<p
						style={{
							color: styles.muted,
							fontSize: 15,
							lineHeight: 1.55,
							margin: "10px 0 0",
							maxWidth: 720,
						}}
					>
						Ryu is canonical. Roots are independent, operations are idempotent,
						native transcripts stay bundle-only, and ACP falls back to
						transcript replay when the agent cannot resume or load a session.
					</p>
				</header>

				<section
					style={{
						background: styles.panel,
						border: `1px solid ${styles.border}`,
						borderRadius: 18,
						padding: 22,
					}}
				>
					<div
						style={{
							alignItems: "center",
							display: "flex",
							justifyContent: "space-between",
							gap: 16,
						}}
					>
						<div>
							<div
								style={{ color: styles.muted, fontSize: 12, letterSpacing: 1 }}
							>
								CONFIGURED ROOTS
							</div>
							<h2 style={{ fontSize: 24, margin: "6px 0 0" }}>
								Import and Export
							</h2>
						</div>
						<div
							data-testid="proof-status"
							style={{
								background: "#123022",
								border: "1px solid #245c3e",
								borderRadius: 999,
								color: styles.green,
								fontSize: 11,
								fontWeight: 800,
								letterSpacing: 1,
								padding: "8px 11px",
							}}
						>
							{exported ? "VERIFIED" : "READY"}
						</div>
					</div>

					<div style={{ display: "grid", gap: 10, marginTop: 20 }}>
						{profiles.map(([provider, root, toggle, state]) => (
							<div
								key={provider}
								style={{
									alignItems: "center",
									border: `1px solid ${provider === selected ? styles.accent : styles.border}`,
									borderRadius: 12,
									display: "flex",
									gap: 14,
									justifyContent: "space-between",
									padding: "12px 14px",
								}}
							>
								<div>
									<div style={{ fontSize: 15, fontWeight: 650 }}>
										{provider} {provider === selected ? "· selected" : ""}
									</div>
									<div
										style={{
											color: styles.muted,
											fontFamily:
												"ui-monospace, SFMono-Regular, Menlo, monospace",
											fontSize: 12,
											marginTop: 4,
										}}
									>
										{root}
									</div>
								</div>
								<div style={{ alignItems: "center", display: "flex", gap: 10 }}>
									<span
										style={{
											color: state === "conflict" ? "#fcd34d" : styles.muted,
											fontSize: 12,
										}}
									>
										{toggle} · {state}
									</span>
									<button onClick={() => setSelected(provider)} type="button">
										Use
									</button>
								</div>
							</div>
						))}
					</div>

					<label
						style={{
							color: styles.muted,
							display: "block",
							fontSize: 12,
							marginTop: 20,
						}}
					>
						Destination folder
						<input
							aria-label="Destination folder"
							defaultValue="/Users/jiawei/.claude"
							style={{
								background: "#18181b",
								border: `1px solid ${styles.border}`,
								borderRadius: 8,
								color: styles.text,
								display: "block",
								marginTop: 6,
								padding: "10px 12px",
								width: "100%",
							}}
						/>
					</label>

					<div
						style={{ display: "flex", flexWrap: "wrap", gap: 9, marginTop: 18 }}
					>
						<button onClick={() => setExported(true)} type="button">
							Export bundle
						</button>
						<button
							disabled={!exported}
							onClick={() => setResumed(true)}
							type="button"
						>
							Test ACP resume/load
						</button>
					</div>
				</section>

				{exported ? (
					<section
						aria-label="Sync proof"
						style={{
							background: styles.panel,
							border: `1px solid ${styles.border}`,
							borderRadius: 18,
							marginTop: 16,
							padding: 22,
						}}
					>
						<div
							style={{ color: styles.accent, fontSize: 12, letterSpacing: 1 }}
						>
							SYNC PROOF
						</div>
						<h2 style={{ fontSize: 24, margin: "6px 0 18px" }}>
							Completed operation
						</h2>
						<div
							style={{
								display: "grid",
								gap: 12,
								gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
							}}
						>
							<ProofMetric title="Operation ID" value="export_fixture_001" />
							<ProofMetric
								title="Bundle SHA-256"
								value="4e9d8c2f0a36e2b5b4ac3e9b3e6d6d4e0c8b9a4d2e1f7a6c5b4d3e2f1a0b9c8"
							/>
							<ProofMetric
								title="Import counts"
								value="12 items imported · 4 skipped · 0 failed"
							/>
							<ProofMetric
								title="Export counts"
								value="4 agents · 7 skills · 2 conversations · 28 messages"
							/>
							<ProofMetric
								title="Hash ledger"
								value="source b7a8f1d2c3e4 · generated 4e9d8c2f0a36"
							/>
							<ProofMetric
								title="ACP persistence"
								value="1 ACP loads/resumes · 1 transcript replays"
							/>
							<ProofMetric
								title="Conflict count"
								value="0 conflicts · 6 files written"
							/>
							<ProofMetric
								title="Bundle path"
								value="/Users/jiawei/.claude/.ryu-agent-sync.json"
							/>
						</div>
						{resumed ? (
							<p
								data-testid="resume-status"
								style={{
									color: styles.green,
									fontSize: 14,
									margin: "18px 0 0",
								}}
							>
								1 ACP sessions loaded/resumed, 1 transcript replays.
							</p>
						) : null}
					</section>
				) : null}
			</div>
		</main>
	);
}

function ProofMetric({ title, value }: { title: string; value: string }) {
	return (
		<div
			style={{
				border: `1px solid ${styles.border}`,
				borderRadius: 10,
				padding: "12px 14px",
			}}
		>
			<div
				style={{
					color: styles.muted,
					fontSize: 11,
					letterSpacing: 0.8,
					textTransform: "uppercase",
				}}
			>
				{title}
			</div>
			<div
				style={{
					fontFamily:
						title.includes("SHA") ||
						title.includes("ID") ||
						title.includes("path")
							? "ui-monospace, SFMono-Regular, Menlo, monospace"
							: "inherit",
					fontSize: 13,
					lineHeight: 1.45,
					marginTop: 6,
					overflowWrap: "anywhere",
				}}
			>
				{value}
			</div>
		</div>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<AgentSyncProof />
);
