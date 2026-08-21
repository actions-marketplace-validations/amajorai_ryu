import { useState } from "react";
import { createRoot } from "react-dom/client";

type Provider = "claude" | "codex";
type ScenarioId = "normal" | "remaining" | "day" | "hour";

interface Scenario {
	description: string;
	id: ScenarioId;
	label: string;
	model: string;
	remaining: string;
	reset: string;
}

interface Directive {
	acp_config?: Record<string, string>;
	effort?: string;
	kind: "none" | "select_model";
	model?: string;
}

const SCENARIOS: Scenario[] = [
	{
		description:
			"No end-window trigger; the ordinary pacing ladder remains in charge.",
		id: "normal",
		label: "Normal window",
		model: "sonnet",
		remaining: "64%",
		reset: "4d 11h",
	},
	{
		description: "The reverse ladder upgrades the current sonnet turn to opus.",
		id: "remaining",
		label: "20% quota left",
		model: "sonnet",
		remaining: "18%",
		reset: "2d 03h",
	},
	{
		description:
			"Within one day of reset, the ACP fast-mode option is selected.",
		id: "day",
		label: "1 day to reset",
		model: "opus",
		remaining: "42%",
		reset: "18h",
	},
	{
		description:
			"The final hour combines fast mode with high reasoning effort.",
		id: "hour",
		label: "1 hour to reset",
		model: "opus",
		remaining: "5%",
		reset: "45m",
	},
];

const PROVIDERS: Record<Provider, { label: string; optionId: string }> = {
	claude: { label: "Claude ACP", optionId: "fast" },
	codex: { label: "Codex ACP", optionId: "fast-mode" },
};

function directiveFor(scenario: ScenarioId, provider: Provider): Directive {
	if (scenario === "normal") {
		return { kind: "none" };
	}

	if (scenario === "remaining") {
		return { kind: "select_model", model: "opus" };
	}

	const directive: Directive = {
		acp_config: { [PROVIDERS[provider].optionId]: "true" },
		kind: "select_model",
		model: "opus",
	};
	if (scenario === "hour") {
		directive.effort = "high";
	}
	return directive;
}

function formatDirective(directive: Directive): string {
	return JSON.stringify(directive, null, 2);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div
			style={{
				background: "#111923",
				border: "1px solid #223040",
				borderRadius: 12,
				padding: "14px 16px",
			}}
		>
			<div
				style={{
					color: "#8292a5",
					fontSize: 11,
					letterSpacing: "0.1em",
					textTransform: "uppercase",
				}}
			>
				{label}
			</div>
			<div
				style={{
					color: "#eef5ff",
					fontSize: 18,
					fontWeight: 700,
					marginTop: 7,
				}}
			>
				{value}
			</div>
		</div>
	);
}

function UsagePacerProof() {
	const [scenarioId, setScenarioId] = useState<ScenarioId>("hour");
	const [provider, setProvider] = useState<Provider>("claude");
	const scenario =
		SCENARIOS.find((item) => item.id === scenarioId) ?? SCENARIOS[0];
	const directive = directiveFor(scenario.id, provider);
	const providerInfo = PROVIDERS[provider];

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
			<div style={{ margin: "0 auto", maxWidth: 980 }}>
				<header>
					<div style={{ alignItems: "center", display: "flex", gap: 12 }}>
						<div
							aria-hidden="true"
							style={{
								alignItems: "center",
								background: "#153c32",
								border: "1px solid #43d39e",
								borderRadius: 12,
								display: "flex",
								fontSize: 22,
								height: 44,
								justifyContent: "center",
								width: 44,
							}}
						>
							↗
						</div>
						<div>
							<div
								style={{
									color: "#43d39e",
									fontSize: 12,
									fontWeight: 700,
									letterSpacing: "0.12em",
								}}
							>
								VERIFIED REACT ARTIFACT
							</div>
							<h1
								style={{
									fontSize: 32,
									letterSpacing: "-0.04em",
									margin: "5px 0 0",
								}}
							>
								Usage Pacer · reverse quota policy
							</h1>
						</div>
					</div>
					<p
						style={{
							color: "#aebdcd",
							fontSize: 16,
							lineHeight: 1.6,
							margin: "20px 0 26px",
							maxWidth: 760,
						}}
					>
						When a subscription window is nearly spent or close to reset, the
						plugin can move back up the model ladder and request provider fast
						mode for this turn.
					</p>
				</header>

				<section
					aria-label="Verification summary"
					style={{
						display: "grid",
						gap: 10,
						gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
					}}
				>
					<Metric label="Hook tests" value="10 / 10 passed" />
					<Metric label="Core route" value="ACP merge passed" />
					<Metric label="Codex ACP" value="fast-mode" />
					<Metric label="Claude ACP" value="fast" />
				</section>

				<section aria-label="Usage window scenarios" style={{ marginTop: 28 }}>
					<div
						style={{
							alignItems: "end",
							display: "flex",
							justifyContent: "space-between",
							marginBottom: 11,
						}}
					>
						<div>
							<h2 style={{ fontSize: 18, margin: 0 }}>Policy simulator</h2>
							<div style={{ color: "#8292a5", fontSize: 13, marginTop: 5 }}>
								Select the usage boundary that the tests exercise.
							</div>
						</div>
						<div style={{ color: "#43d39e", fontSize: 13 }}>
							Upgrade wins fallback
						</div>
					</div>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
						{SCENARIOS.map((item) => {
							const selected = item.id === scenario.id;
							return (
								<button
									aria-pressed={selected}
									data-testid={`scenario-${item.id}`}
									key={item.id}
									onClick={() => setScenarioId(item.id)}
									style={{
										background: selected ? "#173a34" : "#111923",
										border: `1px solid ${selected ? "#43d39e" : "#2a3a4c"}`,
										borderRadius: 9,
										color: selected ? "#c9ffe8" : "#b9c6d4",
										cursor: "pointer",
										fontSize: 13,
										padding: "9px 12px",
									}}
									type="button"
								>
									{item.label}
								</button>
							);
						})}
					</div>
				</section>

				<section
					aria-label="Selected usage window"
					style={{
						background: "#111923",
						border: "1px solid #223040",
						borderRadius: 14,
						marginTop: 16,
						padding: 18,
					}}
				>
					<div
						style={{
							display: "grid",
							gap: 16,
							gridTemplateColumns: "1.2fr repeat(3, 1fr)",
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
								Current boundary
							</div>
							<div style={{ fontSize: 19, fontWeight: 700, marginTop: 6 }}>
								{scenario.label}
							</div>
							<div
								style={{
									color: "#aebdcd",
									fontSize: 13,
									lineHeight: 1.5,
									marginTop: 5,
								}}
							>
								{scenario.description}
							</div>
						</div>
						<div>
							<div
								style={{
									color: "#8292a5",
									fontSize: 11,
									letterSpacing: "0.1em",
									textTransform: "uppercase",
								}}
							>
								Quota left
							</div>
							<strong style={{ display: "block", fontSize: 19, marginTop: 6 }}>
								{scenario.remaining}
							</strong>
						</div>
						<div>
							<div
								style={{
									color: "#8292a5",
									fontSize: 11,
									letterSpacing: "0.1em",
									textTransform: "uppercase",
								}}
							>
								Reset in
							</div>
							<strong style={{ display: "block", fontSize: 19, marginTop: 6 }}>
								{scenario.reset}
							</strong>
						</div>
						<div>
							<div
								style={{
									color: "#8292a5",
									fontSize: 11,
									letterSpacing: "0.1em",
									textTransform: "uppercase",
								}}
							>
								Current model
							</div>
							<strong style={{ display: "block", fontSize: 19, marginTop: 6 }}>
								{scenario.model}
							</strong>
						</div>
					</div>
				</section>

				<section aria-label="Provider fast mode" style={{ marginTop: 28 }}>
					<div
						style={{
							alignItems: "end",
							display: "flex",
							justifyContent: "space-between",
							marginBottom: 11,
						}}
					>
						<div>
							<h2 style={{ fontSize: 18, margin: 0 }}>ACP provider mapping</h2>
							<div style={{ color: "#8292a5", fontSize: 13, marginTop: 5 }}>
								Fast mode is exposed as a provider-specific session config
								option.
							</div>
						</div>
						<div style={{ display: "flex", gap: 7 }}>
							{(["claude", "codex"] as const).map((item) => {
								const selected = provider === item;
								return (
									<button
										aria-pressed={selected}
										key={item}
										onClick={() => setProvider(item)}
										style={{
											background: selected ? "#263147" : "#111923",
											border: `1px solid ${selected ? "#8da9ff" : "#2a3a4c"}`,
											borderRadius: 8,
											color: selected ? "#dfe7ff" : "#aebdcd",
											cursor: "pointer",
											fontSize: 12,
											padding: "8px 10px",
										}}
										type="button"
									>
										{PROVIDERS[item].label}
									</button>
								);
							})}
						</div>
					</div>

					<div
						style={{
							display: "grid",
							gap: 12,
							gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)",
						}}
					>
						<div
							style={{
								background: "#111923",
								border: "1px solid #223040",
								borderRadius: 14,
								padding: 18,
							}}
						>
							<div
								style={{
									color: "#8da9ff",
									fontSize: 12,
									fontWeight: 700,
									letterSpacing: "0.1em",
									textTransform: "uppercase",
								}}
							>
								{providerInfo.label}
							</div>
							<h3 style={{ fontSize: 22, margin: "8px 0 4px" }}>
								{providerInfo.optionId}
							</h3>
							<p
								style={{
									color: "#aebdcd",
									fontSize: 13,
									lineHeight: 1.55,
									margin: 0,
								}}
							>
								Readable rule key <code>fast_mode</code> is translated to the
								adapter's advertised id and sent only for this turn.
							</p>
						</div>
						<div
							style={{
								background: "#070a0e",
								border: "1px solid #223040",
								borderRadius: 14,
								padding: 18,
							}}
						>
							<div
								style={{
									color: "#8292a5",
									fontSize: 11,
									letterSpacing: "0.1em",
									textTransform: "uppercase",
								}}
							>
								Selected directive · {scenario.label}
							</div>
							<pre
								data-testid="directive-output"
								style={{
									color: "#d8e6ff",
									fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
									fontSize: 13,
									lineHeight: 1.55,
									margin: "12px 0 0",
									whiteSpace: "pre-wrap",
								}}
							>
								{formatDirective(directive)}
							</pre>
						</div>
					</div>
				</section>

				<footer
					style={{
						borderTop: "1px solid #1d2a37",
						color: "#8292a5",
						fontSize: 12,
						lineHeight: 1.6,
						marginTop: 28,
						paddingTop: 16,
					}}
				>
					<strong style={{ color: "#b9c6d4" }}>Evidence:</strong> 10 Usage Pacer
					hook tests, the Core ACP merge test, and the existing ACP boolean
					transport test passed. Unknown provider options remain best-effort, so
					an adapter that does not advertise fast mode continues normally.
				</footer>
			</div>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	const globals = globalThis as typeof globalThis & {
		__usagePacerRoot?: ReturnType<typeof createRoot>;
	};
	const reactRoot = globals.__usagePacerRoot ?? createRoot(root);
	globals.__usagePacerRoot = reactRoot;
	reactRoot.render(<UsagePacerProof />);
}
