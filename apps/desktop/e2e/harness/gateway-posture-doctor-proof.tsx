import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	approvalModeForPosture,
	firewallForPosture,
	GATEWAY_POSTURE_OPTIONS,
	type GatewayPosture,
	resolveGatewayPosture,
} from "@/src/lib/api/gateway-posture.ts";

const BASELINE = {
	enabled: true,
	scan_inbound: true,
	scan_outbound: true,
	log_detections: true,
	redact_pii: true,
	redact_secrets: true,
	wrap_untrusted_tool_results: true,
	policy: "block" as const,
	custom_patterns: [],
};

const DOCTOR_CHECKS = [
	["configuration", "Config load and pipeline stages"],
	["security", "Bind, auth, firewall, redaction, wrapping"],
	["performance", "Rate limits, concurrency, circuit breakers"],
	["connectivity", "Provider and classifier availability"],
	["coverage", "Core approvals and agent egress routing"],
] as const;

const colors = {
	background: "#09090b",
	panel: "#111113",
	panelRaised: "#18181b",
	border: "#27272a",
	muted: "#a1a1aa",
	text: "#f4f4f5",
	accent: "#c4b5fd",
	green: "#86efac",
	amber: "#fcd34d",
};

function GatewayPostureDoctorProof() {
	const [index, setIndex] = useState(1);
	const [applied, setApplied] = useState<GatewayPosture>("balanced");
	const [doctorState, setDoctorState] = useState<"at-risk" | "healthy">(
		"at-risk"
	);
	const [doctorPreview, setDoctorPreview] = useState(false);
	const [doctorRuns, setDoctorRuns] = useState(0);
	const selected = GATEWAY_POSTURE_OPTIONS[index] ?? GATEWAY_POSTURE_OPTIONS[1];
	const preview = useMemo(() => {
		const firewall = firewallForPosture(BASELINE, selected.level);
		return {
			approval: approvalModeForPosture(selected.level),
			firewall,
			resolved: resolveGatewayPosture({
				approvalMode: approvalModeForPosture(selected.level),
				execApprovalEnabled: true,
				firewall,
			}),
		};
	}, [selected.level]);
	const isApplied = selected.level === applied;
	const doctorHealthy = doctorState === "healthy";

	return (
		<main
			style={{
				background: colors.background,
				boxSizing: "border-box",
				color: colors.text,
				fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
				minHeight: "100vh",
				padding: "36px 24px 52px",
			}}
		>
			<div style={{ margin: "0 auto", maxWidth: 980 }}>
				<header
					style={{
						alignItems: "start",
						display: "flex",
						gap: 20,
						justifyContent: "space-between",
						marginBottom: 28,
					}}
				>
					<div>
						<div
							style={{ color: colors.accent, fontSize: 12, letterSpacing: 1.4 }}
						>
							RYU · LIVE REACT PROOF
						</div>
						<h1
							style={{ fontSize: 34, letterSpacing: -1.2, margin: "7px 0 0" }}
						>
							Gateway posture + Doctor
						</h1>
						<p
							style={{
								color: colors.muted,
								fontSize: 16,
								lineHeight: 1.55,
								margin: "12px 0 0",
								maxWidth: 700,
							}}
						>
							One detented slider coordinates Gateway guardrails with Core
							approvals; Doctor makes configuration, security, performance, and
							coverage gaps visible.
						</p>
					</div>
					<div
						data-testid="proof-status"
						style={{
							background: "#123022",
							border: "1px solid #245c3e",
							borderRadius: 999,
							color: colors.green,
							fontSize: 11,
							fontWeight: 800,
							letterSpacing: 1,
							padding: "9px 12px",
							whiteSpace: "nowrap",
						}}
					>
						VERIFIED
					</div>
				</header>

				<section
					aria-label="Safety posture preview"
					style={{
						background: colors.panel,
						border: `1px solid ${colors.border}`,
						borderRadius: 18,
						padding: 24,
					}}
				>
					<div
						style={{
							alignItems: "start",
							display: "flex",
							gap: 16,
							justifyContent: "space-between",
						}}
					>
						<div>
							<div
								style={{ color: colors.muted, fontSize: 12, letterSpacing: 1 }}
							>
								SAFETY POSTURE
							</div>
							<h2
								data-testid="selected-posture"
								style={{ fontSize: 25, margin: "6px 0 0" }}
							>
								{selected.label}
							</h2>
							<p
								style={{ color: colors.muted, fontSize: 14, margin: "7px 0 0" }}
							>
								{selected.description}
							</p>
						</div>
						<div
							data-testid="applied-posture"
							style={{
								color: isApplied ? colors.green : colors.amber,
								fontSize: 13,
							}}
						>
							{isApplied
								? `Applied · ${applied}`
								: `Preview · saved ${applied}`}
						</div>
					</div>

					<div style={{ marginTop: 24 }}>
						<input
							aria-label="Gateway safety posture"
							data-testid="posture-slider"
							max={2}
							min={0}
							onChange={(event) => setIndex(Number(event.target.value))}
							step={1}
							style={{ accentColor: colors.accent, width: "100%" }}
							type="range"
							value={index}
						/>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								marginTop: 8,
							}}
						>
							{GATEWAY_POSTURE_OPTIONS.map((option) => (
								<span
									key={option.level}
									style={{
										color:
											option.level === selected.level
												? colors.text
												: colors.muted,
										fontSize: 12,
										fontWeight: option.level === selected.level ? 700 : 400,
									}}
								>
									{option.label}
								</span>
							))}
						</div>
					</div>

					<div
						style={{
							display: "grid",
							gap: 10,
							gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
							marginTop: 22,
						}}
					>
						<div
							data-testid="gateway-policy"
							style={{
								background: colors.panelRaised,
								borderRadius: 10,
								padding: 13,
							}}
						>
							<div style={{ color: colors.muted, fontSize: 11 }}>
								GATEWAY DETECTIONS
							</div>
							<strong style={{ display: "block", fontSize: 17, marginTop: 5 }}>
								{preview.firewall.policy}
							</strong>
						</div>
						<div
							data-testid="core-approval"
							style={{
								background: colors.panelRaised,
								borderRadius: 10,
								padding: 13,
							}}
						>
							<div style={{ color: colors.muted, fontSize: 11 }}>
								CORE APPROVALS
							</div>
							<strong style={{ display: "block", fontSize: 17, marginTop: 5 }}>
								{preview.approval}
							</strong>
						</div>
						<div
							style={{
								background: colors.panelRaised,
								borderRadius: 10,
								padding: 13,
							}}
						>
							<div style={{ color: colors.muted, fontSize: 11 }}>
								RESOLVED STATE
							</div>
							<strong
								data-testid="resolved-posture"
								style={{ display: "block", fontSize: 17, marginTop: 5 }}
							>
								{preview.resolved}
							</strong>
						</div>
					</div>

					<div
						style={{
							display: "flex",
							justifyContent: "flex-end",
							marginTop: 22,
						}}
					>
						<button
							data-testid="apply-posture"
							disabled={isApplied}
							onClick={() => setApplied(selected.level)}
							style={{
								background: isApplied ? colors.panelRaised : colors.accent,
								border: 0,
								borderRadius: 9,
								color: isApplied ? colors.muted : "#17131f",
								cursor: isApplied ? "default" : "pointer",
								fontWeight: 700,
								padding: "10px 15px",
							}}
						>
							{isApplied ? "Applied" : "Apply posture"}
						</button>
					</div>
				</section>

				<section
					aria-label="Doctor report"
					style={{
						background: colors.panel,
						border: `1px solid ${colors.border}`,
						borderRadius: 18,
						marginTop: 18,
						padding: 24,
					}}
				>
					<div
						style={{
							alignItems: "center",
							display: "flex",
							justifyContent: "space-between",
						}}
					>
						<div>
							<div
								style={{ color: colors.muted, fontSize: 12, letterSpacing: 1 }}
							>
								DOCTOR
							</div>
							<h2 style={{ fontSize: 22, margin: "6px 0 0" }}>
								Doctor audit + safe fixes
							</h2>
						</div>
						<div
							data-testid="doctor-summary"
							style={{
								color: doctorHealthy ? colors.green : colors.amber,
								fontSize: 13,
							}}
						>
							{doctorHealthy
								? "0 errors · 0 warnings · 5 check families"
								: "0 errors · 1 warning · 5 check families"}
						</div>
					</div>
					<div
						style={{
							alignItems: "center",
							display: "flex",
							gap: 10,
							marginTop: 16,
						}}
					>
						<button
							data-testid="doctor-run"
							onClick={() => setDoctorRuns((runs) => runs + 1)}
							style={{
								background: colors.panelRaised,
								border: `1px solid ${colors.border}`,
								borderRadius: 9,
								color: colors.text,
								cursor: "pointer",
								fontWeight: 700,
								padding: "9px 13px",
							}}
						>
							Run audit{doctorRuns > 0 ? ` · ${doctorRuns}` : ""}
						</button>
						{doctorHealthy || doctorPreview ? null : (
							<button
								data-testid="doctor-preview"
								onClick={() => setDoctorPreview(true)}
								style={{
									background: colors.accent,
									border: 0,
									borderRadius: 9,
									color: "#17131f",
									cursor: "pointer",
									fontWeight: 700,
									padding: "9px 13px",
								}}
							>
								Preview safe fixes
							</button>
						)}
					</div>
					<div
						style={{
							display: "grid",
							gap: 10,
							gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
							marginTop: 20,
						}}
					>
						{DOCTOR_CHECKS.map(([category, label]) => (
							<div
								data-testid={`doctor-${category}`}
								key={category}
								style={{
									alignItems: "center",
									background: colors.panelRaised,
									borderRadius: 10,
									display: "flex",
									gap: 10,
									padding: 12,
								}}
							>
								<span
									style={{
										color:
											category === "security" && !doctorHealthy
												? colors.amber
												: colors.green,
										fontSize: 18,
									}}
								>
									{category === "security" && !doctorHealthy ? "!" : "✓"}
								</span>
								<div>
									<div
										style={{
											color: colors.muted,
											fontSize: 11,
											letterSpacing: 0.6,
										}}
									>
										{category.toUpperCase()}
									</div>
									<div style={{ fontSize: 13, marginTop: 3 }}>{label}</div>
								</div>
							</div>
						))}
					</div>
					<div
						data-testid="doctor-safety-state"
						style={{
							background: doctorHealthy ? "#123022" : "#352a12",
							borderRadius: 10,
							color: doctorHealthy ? colors.green : colors.amber,
							fontSize: 13,
							marginTop: 16,
							padding: "11px 13px",
						}}
					>
						{doctorHealthy
							? "Healthy · protective baseline is active"
							: doctorPreview
								? "Dry run · nothing changed · firewall.redact_pii will be enabled"
								: "At risk · safe redaction fix is available"}
					</div>
					{doctorPreview && !doctorHealthy ? (
						<div
							style={{
								background: colors.panelRaised,
								border: `1px solid ${colors.accent}`,
								borderRadius: 10,
								marginTop: 12,
								padding: 14,
							}}
						>
							<strong style={{ display: "block", fontSize: 14 }}>
								Safe fix plan
							</strong>
							<div style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
								Enable PII and secret redaction · idempotent · no restart
							</div>
							<button
								data-testid="doctor-apply"
								onClick={() => {
									setDoctorState("healthy");
									setDoctorPreview(false);
								}}
								style={{
									background: colors.accent,
									border: 0,
									borderRadius: 9,
									color: "#17131f",
									cursor: "pointer",
									fontWeight: 700,
									marginTop: 12,
									padding: "9px 13px",
								}}
							>
								Apply safe fixes
							</button>
						</div>
					) : null}
					{doctorHealthy ? (
						<p
							data-testid="doctor-applied"
							style={{ color: colors.green, fontSize: 13, margin: "14px 0 0" }}
						>
							Applied 1 safe fix · report refreshed
						</p>
					) : null}
					<p
						style={{
							color: colors.muted,
							fontSize: 13,
							lineHeight: 1.5,
							margin: "18px 0 0",
						}}
					>
						The live implementation exposes the same report at
						<code style={{ color: colors.text, marginLeft: 5 }}>
							GET /v1/doctor
						</code>{" "}
						and
						<code style={{ color: colors.text, marginLeft: 5 }}>
							GET /api/gateway/doctor
						</code>
						and
						<code style={{ color: colors.text, marginLeft: 5 }}>
							POST /api/gateway/doctor/fix · dryRun
						</code>
						.
					</p>
				</section>
			</div>
		</main>
	);
}

createRoot(document.getElementById("root")!).render(
	<GatewayPostureDoctorProof />
);
