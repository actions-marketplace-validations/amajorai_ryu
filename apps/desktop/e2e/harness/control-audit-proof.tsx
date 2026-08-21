import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

type Scope = "all" | "org" | "gateway";

interface Activity {
	action: string;
	actor: string;
	actorType: "gateway" | "user";
	details: string;
	id: string;
	scope: Exclude<Scope, "all">;
	target: string;
	targetId: string | null;
	when: string;
}

const ACTIVITIES: Activity[] = [
	{
		action: "policy.update",
		actor: "Jia Wei",
		actorType: "user",
		details: "level: org · payload omitted",
		id: "org-policy-1",
		scope: "org",
		target: "policy",
		targetId: "policy-prod",
		when: "Aug 17, 2026 · 10:42 AM",
	},
	{
		action: "config.update",
		actor: "Jia Wei",
		actorType: "user",
		details: "sections: firewall, routing · secrets omitted",
		id: "gateway-config-1",
		scope: "gateway",
		target: "gateway_config",
		targetId: null,
		when: "Aug 17, 2026 · 10:40 AM",
	},
	{
		action: "gateway.provider.update",
		actor: "Jia Wei",
		actorType: "user",
		details: "provider: openai · key value omitted",
		id: "gateway-provider-1",
		scope: "gateway",
		target: "gateway_provider",
		targetId: null,
		when: "Aug 17, 2026 · 10:39 AM",
	},
	{
		action: "gateway.restart",
		actor: "Gateway admin",
		actorType: "gateway",
		details: "gateway process restarted",
		id: "gateway-restart-1",
		scope: "gateway",
		target: "gateway_process",
		targetId: null,
		when: "Aug 17, 2026 · 10:38 AM",
	},
];

const COLORS = {
	accent: "#c4b5fd",
	background: "#09090b",
	border: "#27272a",
	green: "#86efac",
	muted: "#a1a1aa",
	panel: "#111113",
	panelRaised: "#18181b",
	text: "#f4f4f5",
};

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div
			style={{
				background: COLORS.panelRaised,
				border: `1px solid ${COLORS.border}`,
				borderRadius: 12,
				padding: "14px 16px",
			}}
		>
			<div style={{ color: COLORS.muted, fontSize: 12 }}>{label}</div>
			<div style={{ fontSize: 22, fontWeight: 650, marginTop: 5 }}>{value}</div>
		</div>
	);
}

function ProofCheck({ children }: { children: string }) {
	return (
		<li style={{ alignItems: "center", display: "flex", gap: 9 }}>
			<span aria-hidden="true" style={{ color: COLORS.green, fontSize: 17 }}>
				✓
			</span>
			<span>{children}</span>
		</li>
	);
}

function ControlAuditProof() {
	const [scope, setScope] = useState<Scope>("all");
	const visibleActivities = useMemo(
		() =>
			scope === "all"
				? ACTIVITIES
				: ACTIVITIES.filter((activity) => activity.scope === scope),
		[scope]
	);

	return (
		<main
			data-testid="control-audit-proof"
			style={{
				boxSizing: "border-box",
				color: COLORS.text,
				fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
				minHeight: "100vh",
				padding: "32px 24px 48px",
			}}
		>
			<div style={{ margin: "0 auto", maxWidth: 1060 }}>
				<div style={{ alignItems: "center", display: "flex", gap: 12 }}>
					<div
						aria-hidden="true"
						style={{
							alignItems: "center",
							background: "#2e1065",
							border: `1px solid ${COLORS.accent}`,
							borderRadius: 12,
							display: "flex",
							fontSize: 22,
							height: 44,
							justifyContent: "center",
							width: 44,
						}}
					>
						⌁
					</div>
					<div>
						<div
							style={{ color: COLORS.muted, fontSize: 12, letterSpacing: 1 }}
						>
							RYU CONTROL PLANE
						</div>
						<h1 style={{ fontSize: 30, margin: "4px 0 0" }}>
							Audit log · who did what
						</h1>
					</div>
				</div>

				<p
					style={{
						color: COLORS.muted,
						fontSize: 16,
						lineHeight: 1.6,
						margin: "20px 0 24px",
						maxWidth: 760,
					}}
				>
					A single organization view joins authenticated org mutations with
					Gateway control changes. The actor, action, scope, and target remain
					visible while policy bodies and credential values stay out of the log.
				</p>

				<div
					style={{
						display: "grid",
						gap: 12,
						gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
						marginBottom: 16,
					}}
				>
					<Stat label="Org control rows" value="1" />
					<Stat label="Gateway control rows" value="3" />
					<Stat label="Request usage impact" value="0" />
				</div>

				<section
					aria-label="Control activity"
					style={{
						background: COLORS.panel,
						border: `1px solid ${COLORS.border}`,
						borderRadius: 16,
						padding: 20,
					}}
				>
					<div
						style={{
							alignItems: "center",
							display: "flex",
							gap: 8,
							justifyContent: "space-between",
							marginBottom: 16,
						}}
					>
						<div>
							<h2 style={{ fontSize: 17, margin: 0 }}>Control activity</h2>
							<div style={{ color: COLORS.muted, fontSize: 13, marginTop: 5 }}>
								{visibleActivities.length} rows in this view · audit.view
								required
							</div>
						</div>
						<div
							aria-label="Audit scope"
							role="group"
							style={{ display: "flex", gap: 6 }}
						>
							{(["all", "org", "gateway"] as const).map((option) => (
								<button
									aria-pressed={scope === option}
									key={option}
									onClick={() => setScope(option)}
									style={{
										background: scope === option ? "#3f3f46" : "transparent",
										border: `1px solid ${COLORS.border}`,
										borderRadius: 999,
										color: COLORS.text,
										cursor: "pointer",
										fontSize: 12,
										padding: "7px 12px",
									}}
								>
									{option === "all" ? "All controls" : option}
								</button>
							))}
						</div>
					</div>

					<div style={{ overflowX: "auto" }}>
						<table
							style={{
								borderCollapse: "collapse",
								minWidth: 780,
								width: "100%",
							}}
						>
							<thead>
								<tr
									style={{
										color: COLORS.muted,
										fontSize: 12,
										textAlign: "left",
									}}
								>
									{[
										"When",
										"Scope",
										"Actor",
										"Action",
										"Target",
										"Details",
									].map((heading) => (
										<th
											key={heading}
											style={{
												borderBottom: `1px solid ${COLORS.border}`,
												padding: "10px 8px",
											}}
										>
											{heading}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{visibleActivities.map((activity) => (
									<tr key={activity.id}>
										<td
											style={{
												color: COLORS.muted,
												fontSize: 12,
												padding: "14px 8px",
												whiteSpace: "nowrap",
											}}
										>
											{activity.when}
										</td>
										<td style={{ padding: "14px 8px" }}>
											<span
												style={{
													border: `1px solid ${COLORS.border}`,
													borderRadius: 999,
													fontSize: 12,
													padding: "4px 8px",
												}}
											>
												{activity.scope}
											</span>
										</td>
										<td style={{ padding: "14px 8px" }}>
											<div style={{ fontSize: 13, fontWeight: 600 }}>
												{activity.actor}
											</div>
											<div
												style={{
													color: COLORS.muted,
													fontSize: 11,
													marginTop: 3,
												}}
											>
												{activity.actorType}
											</div>
										</td>
										<td
											style={{
												fontFamily:
													"ui-monospace, SFMono-Regular, Menlo, monospace",
												fontSize: 12,
												padding: "14px 8px",
												whiteSpace: "nowrap",
											}}
										>
											{activity.action}
										</td>
										<td style={{ padding: "14px 8px" }}>
											<div style={{ fontSize: 13, fontWeight: 600 }}>
												{activity.target}
											</div>
											{activity.targetId ? (
												<div
													style={{
														color: COLORS.muted,
														fontSize: 11,
														marginTop: 3,
													}}
												>
													{activity.targetId}
												</div>
											) : null}
										</td>
										<td
											style={{
												color: COLORS.muted,
												fontSize: 12,
												padding: "14px 8px",
											}}
										>
											{activity.details}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>

				<section
					aria-label="Verification evidence"
					style={{
						background: COLORS.panel,
						border: `1px solid ${COLORS.border}`,
						borderRadius: 16,
						marginTop: 16,
						padding: 20,
					}}
				>
					<h2 style={{ fontSize: 17, margin: 0 }}>Verification evidence</h2>
					<ul
						style={{
							color: COLORS.muted,
							display: "grid",
							gap: 9,
							listStyle: "none",
							margin: "14px 0 0",
							padding: 0,
						}}
					>
						<ProofCheck>
							Org writes store the authenticated user id and route action.
						</ProofCheck>
						<ProofCheck>
							Gateway config, provider, restart, and Doctor writes emit
							control_change rows.
						</ProofCheck>
						<ProofCheck>
							Gateway rows forward Core’s verified actor id; direct local admins
							remain attributable.
						</ProofCheck>
						<ProofCheck>
							Control rows are excluded from request counts, token totals, and
							usage analytics.
						</ProofCheck>
						<ProofCheck>
							Read access is protected by the audit.view permission.
						</ProofCheck>
					</ul>
					<div
						style={{
							color: COLORS.muted,
							fontSize: 12,
							lineHeight: 1.5,
							marginTop: 16,
						}}
					>
						Rendered contract proof uses the shipped API response shape with
						representative redacted rows. Live local-stack verification is
						environment-dependent.
					</div>
				</section>
			</div>
		</main>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<ControlAuditProof />
);
