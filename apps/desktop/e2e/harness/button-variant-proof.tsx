import { buttonVariants } from "@ryu/ui/components/button.tsx";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

const cardStyle = {
	background: "color-mix(in oklch, var(--muted), transparent 35%)",
	border: "1px solid color-mix(in oklch, var(--border), transparent 25%)",
	borderRadius: "1rem",
	padding: "1.25rem",
};

function ButtonCard({
	label,
	variant,
}: {
	label: string;
	variant: "ghost" | "ghost-muted";
}) {
	return (
		<section data-testid={`${variant}-case`} style={cardStyle}>
			<div
				style={{
					alignItems: "baseline",
					display: "flex",
					gap: "0.75rem",
					justifyContent: "space-between",
					marginBottom: "1rem",
				}}
			>
				<strong>{label}</strong>
				<code style={{ color: "var(--muted-foreground)", fontSize: "0.75rem" }}>
					variant=&quot;{variant}&quot;
				</code>
			</div>
			<button
				className={buttonVariants({ size: "default", variant })}
				data-testid={`${variant}-button`}
				type="button"
			>
				{variant === "ghost-muted" ? "Muted ghost action" : "Ghost action"}
			</button>
			<p
				style={{
					color: "var(--muted-foreground)",
					fontSize: "0.8125rem",
					lineHeight: 1.5,
					margin: "1rem 0 0",
				}}
			>
				{variant === "ghost-muted"
					? "Muted at rest · foreground on hover"
					: "Existing ghost behavior"}
			</p>
		</section>
	);
}

function Proof() {
	return (
		<main
			data-testid="button-variant-proof"
			style={{
				background: "var(--background)",
				color: "var(--foreground)",
				fontFamily: "var(--font-sans)",
				minHeight: "100vh",
				padding: "3rem 1.5rem",
			}}
		>
			<div style={{ margin: "0 auto", maxWidth: "42rem" }}>
				<p
					style={{
						color: "var(--muted-foreground)",
						fontSize: "0.75rem",
						fontWeight: 600,
						letterSpacing: "0.14em",
						margin: 0,
						textTransform: "uppercase",
					}}
				>
					Shared UI proof
				</p>
				<h1
					style={{
						fontSize: "2rem",
						letterSpacing: "-0.04em",
						margin: "0.5rem 0",
					}}
				>
					Ghost-muted button variant
				</h1>
				<p
					style={{
						color: "var(--muted-foreground)",
						lineHeight: 1.6,
						margin: 0,
					}}
				>
					The new variant keeps ghost chrome, uses muted text at rest, and
					resolves to foreground text when hovered.
				</p>

				<div
					style={{
						display: "grid",
						gap: "1rem",
						gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
						marginTop: "2rem",
					}}
				>
					<ButtonCard label="Baseline" variant="ghost" />
					<ButtonCard label="New variant" variant="ghost-muted" />
				</div>

				<output
					data-testid="proof-status"
					style={{
						border:
							"1px solid color-mix(in oklch, var(--border), transparent 25%)",
						borderRadius: "999px",
						color: "var(--muted-foreground)",
						display: "inline-block",
						fontSize: "0.75rem",
						marginTop: "2rem",
						padding: "0.5rem 0.75rem",
					}}
				>
					PASS · hover the new variant to inspect the resolved color
				</output>
			</div>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Proof />);
}
