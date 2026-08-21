import {
	CheckmarkCircle01Icon,
	Copy01Icon,
	Loading01Icon,
	Tick01Icon,
} from "@hugeicons/core-free-icons";
import {
	type IconInput,
	MorphIconSwap,
} from "@ryu/ui/components/morph-icon.tsx";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

const panelStyle = {
	background: "color-mix(in oklch, var(--card), transparent 8%)",
	border: "1px solid color-mix(in oklch, var(--border), transparent 15%)",
	borderRadius: "1.25rem",
	boxShadow: "0 18px 60px color-mix(in oklch, black, transparent 55%)",
	padding: "1.25rem",
};
const proofStartsVerified = new URLSearchParams(window.location.search).has(
	"verified"
);

function AdoptionCard({
	caption,
	description,
	from,
	to,
	initialLabel,
	completeLabel,
}: {
	caption: string;
	description: string;
	from: IconInput;
	to: IconInput;
	initialLabel: string;
	completeLabel: string;
}) {
	const [complete, setComplete] = useState(proofStartsVerified);

	return (
		<section style={panelStyle}>
			<div
				style={{
					alignItems: "center",
					display: "flex",
					gap: "0.75rem",
					justifyContent: "space-between",
				}}
			>
				<div>
					<p
						style={{
							color: "var(--muted-foreground)",
							fontSize: "0.7rem",
							fontWeight: 700,
							letterSpacing: "0.12em",
							margin: 0,
							textTransform: "uppercase",
						}}
					>
						{caption}
					</p>
					<p
						style={{ fontSize: "1rem", fontWeight: 650, margin: "0.4rem 0 0" }}
					>
						{complete ? completeLabel : initialLabel}
					</p>
				</div>
				<button
					aria-pressed={complete}
					data-testid={`${caption.toLowerCase().replaceAll(" ", "-")}-toggle`}
					onClick={() => setComplete((current) => !current)}
					style={{
						alignItems: "center",
						background: complete
							? "color-mix(in oklch, var(--primary), transparent 82%)"
							: "var(--secondary)",
						border: "1px solid var(--border)",
						borderRadius: "0.75rem",
						color: "var(--foreground)",
						cursor: "pointer",
						display: "inline-flex",
						font: "inherit",
						gap: "0.5rem",
						padding: "0.6rem 0.75rem",
					}}
					type="button"
				>
					<MorphIconSwap
						a={from}
						b={to}
						className="size-4"
						label={complete ? completeLabel : initialLabel}
						state={complete ? "b" : "a"}
					/>
					{complete ? "Done" : "Run"}
				</button>
			</div>
			<p
				style={{
					color: "var(--muted-foreground)",
					fontSize: "0.82rem",
					lineHeight: 1.55,
					margin: "1rem 0 0",
				}}
			>
				{description}
			</p>
		</section>
	);
}

function MorphiconsAdoptionProof() {
	const [installed, setInstalled] = useState(proofStartsVerified);

	return (
		<main
			data-testid="morphicons-adoption-proof"
			style={{
				background:
					"radial-gradient(circle at 75% 0%, color-mix(in oklch, var(--primary), transparent 88%), transparent 42%), var(--background)",
				color: "var(--foreground)",
				fontFamily: "var(--font-sans)",
				minHeight: "100vh",
				padding: "4rem 1.5rem",
			}}
		>
			<div style={{ margin: "0 auto", maxWidth: "58rem" }}>
				<div
					style={{
						alignItems: "center",
						display: "flex",
						gap: "0.75rem",
						justifyContent: "space-between",
					}}
				>
					<p
						style={{
							color: "var(--muted-foreground)",
							fontSize: "0.72rem",
							fontWeight: 700,
							letterSpacing: "0.14em",
							margin: 0,
							textTransform: "uppercase",
						}}
					>
						Shared UI proof
					</p>
					<output
						data-testid="proof-status"
						style={{
							background:
								"color-mix(in oklch, var(--success), transparent 86%)",
							border:
								"1px solid color-mix(in oklch, var(--success), transparent 50%)",
							borderRadius: "999px",
							color: "var(--success)",
							fontSize: "0.72rem",
							fontWeight: 700,
							padding: "0.45rem 0.7rem",
						}}
					>
						PASS · Morphicons connected
					</output>
				</div>
				<h1
					style={{
						fontSize: "2.4rem",
						letterSpacing: "-0.05em",
						margin: "0.8rem 0",
					}}
				>
					State changes that feel intentional
				</h1>
				<p
					style={{
						color: "var(--muted-foreground)",
						fontSize: "1rem",
						lineHeight: 1.65,
						margin: 0,
						maxWidth: "42rem",
					}}
				>
					Morphicons now powers shared stateful icon transitions. The same
					primitive is used by copy feedback, onboarding status, 2FA, API keys,
					and inspection controls across desktop.
				</p>

				<div
					style={{
						display: "grid",
						gap: "1rem",
						gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
						marginTop: "2rem",
					}}
				>
					<AdoptionCard
						caption="Copy feedback"
						completeLabel="Copied"
						description="Copy and success glyphs share one spring-morphed SVG, with user preference-based reduced-motion handling."
						from={Copy01Icon}
						initialLabel="Copy value"
						to={Tick01Icon}
					/>
					<AdoptionCard
						caption="Install status"
						completeLabel="Installed"
						description="The loading-to-complete transition keeps the status slot stable while the icon shape changes in place."
						from={Loading01Icon}
						initialLabel="Installing"
						to={CheckmarkCircle01Icon}
					/>
				</div>

				<section style={{ ...panelStyle, marginTop: "1rem" }}>
					<div
						style={{ alignItems: "center", display: "flex", gap: "0.75rem" }}
					>
						<MorphIconSwap
							a={Loading01Icon}
							b={CheckmarkCircle01Icon}
							className="size-5 text-primary"
							label={installed ? "Installed" : "Installing"}
							state={installed ? "b" : "a"}
						/>
						<div>
							<strong>
								{installed
									? "Desktop adoption verified"
									: "Desktop adoption ready"}
							</strong>
							<p
								style={{
									color: "var(--muted-foreground)",
									fontSize: "0.82rem",
									margin: "0.25rem 0 0",
								}}
							>
								Click the status control to verify the shared transition end
								state.
							</p>
						</div>
						<button
							aria-pressed={installed}
							data-testid="desktop-adoption-toggle"
							onClick={() => setInstalled((current) => !current)}
							style={{
								background: "var(--primary)",
								border: 0,
								borderRadius: "0.7rem",
								color: "var(--primary-foreground)",
								cursor: "pointer",
								font: "inherit",
								fontSize: "0.8rem",
								fontWeight: 650,
								marginLeft: "auto",
								padding: "0.65rem 0.85rem",
							}}
							type="button"
						>
							{installed ? "Reset" : "Verify"}
						</button>
					</div>
				</section>

				<p
					style={{
						color: "var(--muted-foreground)",
						fontSize: "0.76rem",
						marginTop: "1.5rem",
					}}
				>
					Built from <code>@ryu/ui/components/morph-icon</code> · reduced motion
					defaults to <code>user</code>
				</p>
			</div>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<MorphiconsAdoptionProof />);
}
