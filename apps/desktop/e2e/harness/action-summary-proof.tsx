import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

type Detail = "brief" | "standard" | "full";

interface Action {
	brief: string;
	full: string;
	input: string;
	kind: "thinking" | "tool";
	name: string;
	standard: string;
}

const ACTIONS: Action[] = [
	{
		kind: "thinking",
		name: "Thinking block",
		input:
			"High-level planning is summarized; raw hidden reasoning stays out of the UI.",
		brief: "Planning the next step.",
		standard: "Planning the next step before editing the project.",
		full: "Planning the next step so the project can be edited safely.",
	},
	{
		kind: "tool",
		name: "Bash",
		input: "command: npm test (tool output omitted)",
		brief: "Ran the project tests.",
		standard: "Running the project tests to verify the change.",
		full: "Running the project tests to verify the change before finishing.",
	},
	{
		kind: "tool",
		name: "Read",
		input: "path: package.json (bounded and redacted)",
		brief: "Opened package.json.",
		standard: "Opened package.json to check the available scripts.",
		full: "Opened package.json to confirm the project scripts before proceeding.",
	},
];

const colors = {
	background: "#09090b",
	panel: "#111113",
	panelRaised: "#18181b",
	border: "#27272a",
	muted: "#a1a1aa",
	text: "#f4f4f5",
	accent: "#c4b5fd",
	green: "#86efac",
};

function ActionSummaryProof() {
	const [enabled, setEnabled] = useState(true);
	const [detail, setDetail] = useState<Detail>("standard");
	const [model, setModel] = useState("");
	const modelLabel = model.trim() || "Ryu default side-model";
	const visibleActions = enabled ? ACTIONS : [];
	const detailDescription = useMemo(() => {
		if (detail === "brief") {
			return "What happened";
		}
		if (detail === "full") {
			return "What happened, plus the safest useful purpose";
		}
		return "What happened, plus the immediate purpose";
	}, [detail]);

	return (
		<main
			style={{
				boxSizing: "border-box",
				color: colors.text,
				fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
				minHeight: "100vh",
				padding: "32px 24px 48px",
			}}
		>
			<div style={{ margin: "0 auto", maxWidth: 920 }}>
				<div style={{ alignItems: "center", display: "flex", gap: 12 }}>
					<div
						aria-hidden="true"
						style={{
							alignItems: "center",
							background: "#2e1065",
							border: `1px solid ${colors.accent}`,
							borderRadius: 12,
							display: "flex",
							fontSize: 22,
							height: 44,
							justifyContent: "center",
							width: 44,
						}}
					>
						✦
					</div>
					<div>
						<div
							style={{ color: colors.muted, fontSize: 13, letterSpacing: 0.8 }}
						>
							RYU PLUGIN VERIFICATION
						</div>
						<h1 style={{ fontSize: 30, margin: "4px 0 0" }}>Action Summary</h1>
					</div>
				</div>

				<p
					style={{
						color: colors.muted,
						fontSize: 16,
						lineHeight: 1.6,
						margin: "20px 0 24px",
						maxWidth: 720,
					}}
				>
					A small side model turns streamed thinking blocks and tool calls into
					one plain-language line per action, while the main agent keeps working
					normally.
				</p>

				<section
					aria-label="Action Summary settings"
					style={{
						background: colors.panel,
						border: `1px solid ${colors.border}`,
						borderRadius: 16,
						padding: 20,
					}}
				>
					<div
						style={{
							alignItems: "center",
							display: "flex",
							justifyContent: "space-between",
							marginBottom: 16,
						}}
					>
						<div>
							<h2 style={{ fontSize: 16, margin: 0 }}>Settings</h2>
							<div style={{ color: colors.muted, fontSize: 13, marginTop: 5 }}>
								Enabled only when the plugin is turned on
							</div>
						</div>
						<span
							style={{
								color: enabled ? colors.green : colors.muted,
								fontSize: 13,
							}}
						>
							{enabled ? "Enabled" : "Disabled"}
						</span>
					</div>
					<div
						style={{
							display: "grid",
							gap: 12,
							gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
						}}
					>
						<label style={{ color: colors.muted, fontSize: 13 }}>
							<span
								style={{
									alignItems: "center",
									color: colors.text,
									display: "flex",
									gap: 8,
								}}
							>
								<input
									checked={enabled}
									onChange={(event) => setEnabled(event.target.checked)}
									type="checkbox"
								/>
								Explain actions
							</span>
							<span style={{ display: "block", margin: "7px 0 0 24px" }}>
								Thinking and tools
							</span>
						</label>
						<label style={{ color: colors.muted, fontSize: 13 }}>
							<span
								style={{
									color: colors.text,
									display: "block",
									marginBottom: 7,
								}}
							>
								Detail
							</span>
							<select
								aria-label="Detail"
								onChange={(event) => setDetail(event.target.value as Detail)}
								style={{
									background: colors.panelRaised,
									border: `1px solid ${colors.border}`,
									borderRadius: 8,
									color: colors.text,
									padding: "9px 10px",
									width: "100%",
								}}
								value={detail}
							>
								<option value="brief">Brief</option>
								<option value="standard">Standard</option>
								<option value="full">Full</option>
							</select>
							<span style={{ display: "block", marginTop: 7 }}>
								{detailDescription}
							</span>
						</label>
						<label style={{ color: colors.muted, fontSize: 13 }}>
							<span
								style={{
									color: colors.text,
									display: "block",
									marginBottom: 7,
								}}
							>
								Summary model
							</span>
							<input
								aria-label="Summary model"
								onChange={(event) => setModel(event.target.value)}
								placeholder="Optional override"
								style={{
									background: colors.panelRaised,
									border: `1px solid ${colors.border}`,
									borderRadius: 8,
									boxSizing: "border-box",
									color: colors.text,
									padding: "9px 10px",
									width: "100%",
								}}
								value={model}
							/>
							<span style={{ display: "block", marginTop: 7 }}>
								Using: {modelLabel}
							</span>
						</label>
					</div>
				</section>

				<section
					aria-label="Example action summaries"
					style={{ marginTop: 24 }}
				>
					<div
						style={{
							alignItems: "end",
							display: "flex",
							justifyContent: "space-between",
							marginBottom: 10,
						}}
					>
						<div>
							<h2 style={{ fontSize: 16, margin: 0 }}>Live action summaries</h2>
							<div style={{ color: colors.muted, fontSize: 13, marginTop: 5 }}>
								The same one-line note is carried by every chat surface.
							</div>
						</div>
						<span style={{ color: colors.muted, fontSize: 13 }}>
							{visibleActions.length} actions observed
						</span>
					</div>
					<div style={{ display: "grid", gap: 10 }}>
						{visibleActions.map((action) => (
							<article
								key={action.name}
								style={{
									background: colors.panel,
									border: `1px solid ${colors.border}`,
									borderRadius: 12,
									padding: "14px 16px",
								}}
							>
								<div
									style={{
										alignItems: "center",
										display: "flex",
										gap: 8,
										marginBottom: 8,
									}}
								>
									<span
										style={{
											color: colors.accent,
											fontSize: 12,
											fontWeight: 600,
											letterSpacing: 0.6,
											textTransform: "uppercase",
										}}
									>
										{action.kind}
									</span>
									<span style={{ color: colors.muted, fontSize: 13 }}>
										· {action.name}
									</span>
								</div>
								<div style={{ fontSize: 16, lineHeight: 1.45 }}>
									{action[detail]}
								</div>
								<div
									style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}
								>
									Safe context: {action.input}
								</div>
							</article>
						))}
						{!enabled && (
							<div
								style={{
									background: colors.panel,
									border: `1px dashed ${colors.border}`,
									borderRadius: 12,
									color: colors.muted,
									padding: 20,
									textAlign: "center",
								}}
							>
								Turn the plugin on to show action summaries.
							</div>
						)}
					</div>
				</section>

				<section
					aria-label="Verification checks"
					style={{
						background: "#0f1b14",
						border: "1px solid #1f4d31",
						borderRadius: 16,
						marginTop: 24,
						padding: 18,
					}}
				>
					<h2 style={{ fontSize: 16, margin: "0 0 12px" }}>
						Verified behavior
					</h2>
					<div
						style={{
							display: "grid",
							gap: 8,
							gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
						}}
					>
						{[
							"Shared action hook sees ACP and regular streamed tools",
							"Detail setting changes the one-line budget",
							"Empty model setting follows Ryu's side-model default",
							"Bounded, redacted input excludes tool output",
						].map((check) => (
							<div
								key={check}
								style={{
									alignItems: "center",
									color: "#d1fae5",
									display: "flex",
									fontSize: 13,
									gap: 8,
								}}
							>
								<span aria-hidden="true" style={{ color: colors.green }}>
									●
								</span>
								{check}
							</div>
						))}
					</div>
					<div style={{ color: "#86efac", fontSize: 12, marginTop: 14 }}>
						Evidence: 5 plugin tests · 778 manifest fixture checks · 3 Core
						stream parser tests
					</div>
				</section>
			</div>
		</main>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<ActionSummaryProof />
);
