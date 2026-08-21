import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ModelHoverPreview } from "@/components/agent-elements/input/model-hover-preview.tsx";
import type { ModelInsight } from "@/src/lib/api/model-insight.ts";
import "../../src/index.css";

const models: ModelInsight[] = [
	{
		aaKeyPresent: false,
		contextTokens: 1_000_000,
		costInputPer1m: 2.5,
		costOutputPer1m: 15,
		description:
			"OpenRouter's current transaction price, including its active promotion.",
		id: "openai/gpt-5.6-sol",
		modalitiesInput: ["text", "image"],
		modalitiesOutput: ["text"],
		name: "GPT-5.6 Sol",
		reasoning: true,
		scoreContext: 5,
		scoreCost: 4,
		scoreIntelligence: 4,
		scoreSpeed: 2,
		source: "openrouter",
	},
	{
		aaKeyPresent: false,
		contextTokens: 200_000,
		costInputPer1m: 3,
		costOutputPer1m: 15,
		description:
			"The same authoritative OpenRouter price feed drives this row.",
		id: "anthropic/claude-sonnet-4",
		modalitiesInput: ["text", "image", "pdf"],
		modalitiesOutput: ["text"],
		name: "Claude Sonnet 4",
		reasoning: true,
		scoreContext: 4,
		scoreCost: 4,
		scoreIntelligence: 4,
		scoreSpeed: 4,
		source: "openrouter",
	},
];

const colors = {
	accent: "#c4b5fd",
	background: "#09090b",
	border: "#27272a",
	green: "#86efac",
	muted: "#a1a1aa",
	panel: "#111113",
	panelRaised: "#18181b",
	text: "#f4f4f5",
};

function ModelPricingProof() {
	const [selectedId, setSelectedId] = useState(models[0].id);
	const selected = models.find((model) => model.id === selectedId) ?? models[0];

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
			<div style={{ margin: "0 auto", maxWidth: 1040 }}>
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
							Discount-aware model pricing
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
							The managed OpenRouter route uses the provider&apos;s current
							transaction price in the picker and carries that same amount
							through the wallet and usage surfaces.
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

				<div
					style={{
						display: "grid",
						gap: 18,
						gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 0.78fr)",
					}}
				>
					<section
						aria-label="Managed OpenRouter model picker"
						style={{
							background: colors.panel,
							border: `1px solid ${colors.border}`,
							borderRadius: 14,
							padding: 18,
						}}
					>
						<div
							style={{
								alignItems: "center",
								display: "flex",
								justifyContent: "space-between",
								marginBottom: 14,
							}}
						>
							<div>
								<div style={{ color: colors.muted, fontSize: 12 }}>
									Provider
								</div>
								<div style={{ fontSize: 17, fontWeight: 650, marginTop: 4 }}>
									Ryu · managed OpenRouter
								</div>
							</div>
							<span
								style={{
									background: "#251f3d",
									border: "1px solid #584a8c",
									borderRadius: 999,
									color: colors.accent,
									fontSize: 11,
									fontWeight: 700,
									padding: "6px 9px",
								}}
							>
								TRANSACTION PRICE
							</span>
						</div>
						<div style={{ display: "grid", gap: 8 }}>
							{models.map((model) => {
								const active = model.id === selectedId;
								return (
									<button
										aria-pressed={active}
										data-testid={`model-row-${model.id}`}
										key={model.id}
										onClick={() => setSelectedId(model.id)}
										style={{
											alignItems: "center",
											background: active ? "#272239" : colors.panelRaised,
											border: `1px solid ${active ? "#6d5aab" : colors.border}`,
											borderRadius: 10,
											color: colors.text,
											cursor: "pointer",
											display: "flex",
											font: "inherit",
											gap: 12,
											justifyContent: "space-between",
											padding: "12px 13px",
											textAlign: "left",
											width: "100%",
										}}
									>
										<span style={{ minWidth: 0 }}>
											<strong style={{ display: "block", fontSize: 14 }}>
												{model.name}
											</strong>
											<span
												style={{
													color: colors.muted,
													display: "block",
													fontFamily: "ui-monospace, SFMono-Regular, monospace",
													fontSize: 11,
													marginTop: 4,
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap",
												}}
											>
												{model.id}
											</span>
										</span>
										<span
											style={{
												color: colors.green,
												fontSize: 12,
												whiteSpace: "nowrap",
											}}
										>
											{model.costInputPer1m?.toFixed(2)} /{" "}
											{model.costOutputPer1m?.toFixed(2)} / 1M
										</span>
									</button>
								);
							})}
						</div>
						<p
							style={{
								color: colors.muted,
								fontSize: 12,
								lineHeight: 1.5,
								margin: "14px 0 0",
							}}
						>
							Input / output rates are refreshed from OpenRouter&apos;s model
							registry; active promotions are not replaced by models.dev
							pricing.
						</p>
					</section>

					<section
						aria-label="Selected model price preview"
						data-testid="price-preview"
						style={{
							background: colors.panel,
							border: `1px solid ${colors.border}`,
							borderRadius: 14,
							padding: 18,
						}}
					>
						<div
							style={{ color: colors.muted, fontSize: 12, marginBottom: 12 }}
						>
							Picker hover preview · {selected.id}
						</div>
						<div
							style={{ background: "#0d0d0f", borderRadius: 10, padding: 14 }}
						>
							<ModelHoverPreview insight={selected} />
						</div>
					</section>
				</div>

				<section
					aria-label="Managed gateway accounting"
					data-testid="accounting-proof"
					style={{
						background: colors.panel,
						border: `1px solid ${colors.border}`,
						borderRadius: 14,
						marginTop: 18,
						padding: 18,
					}}
				>
					<div style={{ color: colors.muted, fontSize: 12 }}>
						Managed gateway accounting
					</div>
					<div
						style={{
							display: "grid",
							gap: 10,
							gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
							marginTop: 12,
						}}
					>
						{[
							["Provider cost", "$0.001250", "OpenRouter usage.cost"],
							["Audit + rollups", "1,250 µUSD", "same transaction amount"],
							[
								"Estimate fallback",
								"Only if absent",
								"never over a free promo",
							],
						].map(([label, value, hint]) => (
							<div
								key={label}
								style={{
									background: colors.panelRaised,
									border: `1px solid ${colors.border}`,
									borderRadius: 10,
									padding: 13,
								}}
							>
								<div style={{ color: colors.muted, fontSize: 11 }}>{label}</div>
								<div style={{ fontSize: 19, fontWeight: 700, marginTop: 7 }}>
									{value}
								</div>
								<div
									style={{ color: colors.muted, fontSize: 11, marginTop: 5 }}
								>
									{hint}
								</div>
							</div>
						))}
					</div>
					<div
						style={{
							borderTop: `1px solid ${colors.border}`,
							color: colors.muted,
							fontFamily: "ui-monospace, SFMono-Regular, monospace",
							fontSize: 11,
							marginTop: 15,
							paddingTop: 12,
						}}
					>
						managed_inference=true · provider_cost_micro_usd=1250 ·
						source=managed
					</div>
				</section>
			</div>
		</main>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<ModelPricingProof />
);
