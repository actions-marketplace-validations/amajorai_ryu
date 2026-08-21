import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const colors = {
	background: "#09090b",
	panel: "#111113",
	border: "#2d2d32",
	muted: "#a1a1aa",
	text: "#f4f4f5",
	accent: "#60a5fa",
	accentSoft: "rgba(96, 165, 250, 0.16)",
	green: "#86efac",
};

const FADE_AFTER_MS = 2400;
const FADE_DURATION_MS = 420;
const GHOST_CURSOR_OPACITY = 0.68;

function CursorPreview({ faded }: { faded: boolean }) {
	return (
		<div
			aria-hidden="true"
			data-testid="ghost-cursor-marker"
			style={{
				left: 406,
				top: 164,
				opacity: faded ? 0 : GHOST_CURSOR_OPACITY,
				pointerEvents: "none",
				position: "absolute",
				transform: "translate(0, 0)",
				transition: `opacity ${FADE_DURATION_MS}ms ease`,
				zIndex: 2,
			}}
		>
			<svg
				aria-hidden="true"
				height="26"
				style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,.28))" }}
				viewBox="0 0 27 31"
				width="22"
			>
				<path
					d="M2 1L21 13.5L13.3 14.8L17.2 24L13.7 25.4L9.7 16.2L3.7 20.2Z"
					fill="rgba(248,250,252,.98)"
					stroke="rgba(15,23,42,.9)"
					strokeLinejoin="round"
					strokeWidth="1.2"
				/>
			</svg>
			<div
				data-testid="ghost-intent-label"
				style={{
					alignItems: "center",
					background: "rgba(15, 23, 42, .88)",
					border: "1px solid rgba(255,255,255,.16)",
					borderRadius: 999,
					boxShadow: "0 3px 12px rgba(0,0,0,.28)",
					color: "white",
					display: "flex",
					fontSize: 11,
					fontWeight: 600,
					gap: 6,
					left: 40,
					padding: "5px 9px 5px 7px",
					position: "absolute",
					top: -18,
					whiteSpace: "nowrap",
				}}
			>
				<span
					aria-hidden="true"
					style={{
						background: colors.accent,
						borderRadius: "50%",
						height: 6,
						width: 6,
					}}
				/>
				Click “Send”
			</div>
		</div>
	);
}

function StatusRow({ label, value }: { label: string; value: string }) {
	return (
		<div
			style={{
				alignItems: "center",
				borderBottom: `1px solid ${colors.border}`,
				display: "flex",
				justifyContent: "space-between",
				padding: "11px 0",
			}}
		>
			<span style={{ color: colors.muted, fontSize: 13 }}>{label}</span>
			<span style={{ color: colors.green, fontSize: 13, fontWeight: 600 }}>
				{value}
			</span>
		</div>
	);
}

function GhostCursorProof() {
	const [faded, setFaded] = useState(false);
	const [replay, setReplay] = useState(0);

	useEffect(() => {
		setFaded(false);
		const timer = window.setTimeout(() => setFaded(true), FADE_AFTER_MS);
		return () => window.clearTimeout(timer);
	}, [replay]);

	return (
		<main
			data-testid="ghost-cursor-proof"
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
							background: "#172554",
							border: `1px solid ${colors.accent}`,
							borderRadius: 12,
							display: "flex",
							fontSize: 22,
							height: 44,
							justifyContent: "center",
							width: 44,
						}}
					>
						➤
					</div>
					<div>
						<div
							style={{ color: colors.muted, fontSize: 13, letterSpacing: 0.8 }}
						>
							GHOST MCP · VERIFICATION PROOF
						</div>
						<h1 style={{ fontSize: 30, margin: "4px 0 0" }}>
							Visible computer-use cursor
						</h1>
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
					The MCP action event carries a short intent to the click-through
					Island overlay. The cursor lands on the target, gives a click ripple,
					and fades after the action instead of competing with the user’s
					pointer.
				</p>

				<section
					aria-label="Ghost cursor live preview"
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
							<h2 style={{ fontSize: 16, margin: 0 }}>Live action preview</h2>
							<div style={{ color: colors.muted, fontSize: 13, marginTop: 5 }}>
								Synthetic event: ghost_click → target “Send”
							</div>
						</div>
						<button
							data-testid="ghost-cursor-replay"
							onClick={() => setReplay((value) => value + 1)}
							style={{
								background: colors.accentSoft,
								border: `1px solid ${colors.accent}`,
								borderRadius: 8,
								color: colors.text,
								cursor: "pointer",
								fontWeight: 600,
								padding: "9px 12px",
							}}
						>
							Replay click
						</button>
					</div>

					<div
						data-testid="ghost-cursor-preview"
						style={{
							background:
								"linear-gradient(135deg, #20202a 0%, #16161c 55%, #101014 100%)",
							border: `1px solid ${colors.border}`,
							borderRadius: 12,
							height: 340,
							overflow: "hidden",
							position: "relative",
						}}
					>
						<div
							style={{
								color: colors.muted,
								fontSize: 12,
								left: 22,
								position: "absolute",
								top: 20,
							}}
						>
							Target app · Send message
						</div>
						<button
							style={{
								background: colors.accent,
								border: 0,
								borderRadius: 8,
								color: "#07111f",
								fontSize: 14,
								fontWeight: 700,
								left: 390,
								padding: "10px 18px",
								position: "absolute",
								top: 160,
							}}
						>
							Send
						</button>
						<CursorPreview faded={faded} />
					</div>
					<div
						aria-live="polite"
						data-testid="ghost-cursor-state"
						style={{ color: colors.muted, fontSize: 13, marginTop: 12 }}
					>
						{faded
							? `Faded after ${FADE_AFTER_MS / 1000}s idle`
							: "Visible · easing to target · intent chip attached"}
					</div>
				</section>

				<section
					aria-label="Ghost cursor contract"
					style={{
						background: colors.panel,
						border: `1px solid ${colors.border}`,
						borderRadius: 16,
						marginTop: 20,
						padding: "8px 20px 4px",
					}}
				>
					<StatusRow label="Intent field" value={"Click “Send”"} />
					<StatusRow label="Pointer surface" value="click-through" />
					<StatusRow label="Idle fade" value="2.4s + 420ms" />
					<StatusRow label="Physical cursor" value="unchanged" />
				</section>
			</div>
		</main>
	);
}

type GhostCursorProofWindow = Window & {
	__ghostCursorProofRoot?: ReturnType<typeof createRoot>;
};

const proofRoot = document.getElementById("root");
if (proofRoot) {
	const proofWindow = window as GhostCursorProofWindow;
	const root = proofWindow.__ghostCursorProofRoot ?? createRoot(proofRoot);
	proofWindow.__ghostCursorProofRoot = root;
	root.render(<GhostCursorProof />);
}
