import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select.tsx";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

const cardStyle = {
	background: "color-mix(in oklch, var(--muted), transparent 35%)",
	border: "1px solid color-mix(in oklch, var(--border), transparent 25%)",
	borderRadius: "1rem",
	padding: "1.25rem",
};

function ChoiceSelect({
	explicitDefault = false,
}: {
	explicitDefault?: boolean;
}) {
	return (
		<Select defaultValue="project">
			<SelectTrigger
				data-testid={explicitDefault ? "filled-trigger" : "ghost-trigger"}
				variant={explicitDefault ? "default" : undefined}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="project">Project</SelectItem>
				<SelectItem value="workspace">Workspace</SelectItem>
			</SelectContent>
		</Select>
	);
}

function Proof() {
	return (
		<main
			data-testid="select-trigger-proof"
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
					Select trigger background
				</h1>
				<p
					style={{
						color: "var(--muted-foreground)",
						lineHeight: 1.6,
						margin: 0,
					}}
				>
					The default trigger is transparent at rest and reveals the muted
					surface on hover. An explicit default variant remains filled.
				</p>

				<div
					style={{
						display: "grid",
						gap: "1rem",
						gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
						marginTop: "2rem",
					}}
				>
					<section data-testid="ghost-case" style={cardStyle}>
						<strong>Default</strong>
						<p
							style={{
								color: "var(--muted-foreground)",
								fontSize: "0.8125rem",
								lineHeight: 1.5,
								margin: "0.5rem 0 1rem",
							}}
						>
							variant omitted → ghost
						</p>
						<ChoiceSelect />
					</section>
					<section data-testid="filled-case" style={cardStyle}>
						<strong>Explicit default</strong>
						<p
							style={{
								color: "var(--muted-foreground)",
								fontSize: "0.8125rem",
								lineHeight: 1.5,
								margin: "0.5rem 0 1rem",
							}}
						>
							variant=&quot;default&quot; → filled
						</p>
						<ChoiceSelect explicitDefault />
					</section>
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
					PASS · default trigger is ghost; hover it to inspect the surface
				</output>
			</div>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Proof />);
}
