import { planTierOpaqueInk } from "../components/plan-badge.tsx";
import { proBadgeBackgroundDataUri } from "./og-prism.ts";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export interface OgCardProps {
	eyebrow?: string;
	title?: string;
}

/** Bound public labels by Unicode code points; descriptions never enter the image. */
export function ogLabel(value: string | undefined, limit = 80): string {
	const characters = Array.from(value?.replace(/\s+/gu, " ").trim() ?? "");
	return characters.length > limit
		? `${characters
				.slice(0, limit - 1)
				.join("")
				.trimEnd()}…`
		: characters.join("");
}

const INK = planTierOpaqueInk("pro");

// The Ryu ghost mark, drawn from the same 24-unit path as the app Logo's
// `outline` variant (stroked body, solid eyes), inlined as a data-URI SVG so it
// renders crisp at any size without a network hop. The viewBox is padded so the
// stroke never clips at the edges.
const GHOST_PATH =
	"M12,24c9.2,0,12.9-4.8,12.4-14.6C24.1,0.3,12.8-3.7,8.8,5.4c-2.2,5.7,1.1,7.9-2.9,12.6c-0.9,1.1-1.8,2-2.7,3.1c-1.2,1.3,0.7,2.2,1.9,2.2C7.4,23.3,9.7,24,12,24z";
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 28 28"><path d="${GHOST_PATH}" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="15" cy="10" rx="1.5" ry="3" fill="${INK}"/><ellipse cx="19" cy="10" rx="1.5" ry="3" fill="${INK}"/></svg>`;
const LOGO_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(LOGO_SVG)}`;

/** Server-safe composition shared by Web and Docs, with no remote image dependencies. */
export function OgCard({ title, eyebrow }: OgCardProps = {}) {
	const label = ogLabel(title);
	const personalized = Boolean(label && label.toLowerCase() !== "ryu");
	const context = ogLabel(eyebrow, 24);
	const brand =
		context && context.toLowerCase() !== label.toLowerCase()
			? `Ryu ${context}`
			: "Ryu";
	const fontSize = label.length > 48 ? 56 : label.length > 24 ? 72 : 88;
	return (
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				position: "relative",
				backgroundColor: "#ffffff",
				fontFamily: "Inter",
				color: INK,
			}}
		>
			{/* biome-ignore lint/performance/noImgElement: ImageResponse rasterizes this image. */}
			<img
				alt=""
				height={OG_SIZE.height}
				src={proBadgeBackgroundDataUri()}
				style={{ position: "absolute", left: 0, top: 0 }}
				width={OG_SIZE.width}
			/>
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					position: "relative",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					padding: "72px",
					gap: "28px",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: personalized ? "12px" : "30px",
					}}
				>
					{/* biome-ignore lint/performance/noImgElement: ImageResponse rasterizes this image. */}
					<img
						alt=""
						height={personalized ? 40 : 136}
						src={LOGO_DATA_URI}
						width={personalized ? 40 : 136}
					/>
					<span
						style={{
							fontSize: personalized ? "30px" : "112px",
							fontWeight: 500,
							lineHeight: 1,
							letterSpacing: personalized ? "-0.5px" : "-4px",
						}}
					>
						{personalized ? brand : "Ryu"}
					</span>
				</div>
				{personalized ? (
					<div
						style={{
							display: "flex",
							justifyContent: "center",
							width: "100%",
							fontSize,
							fontWeight: 500,
							lineHeight: 1.12,
							letterSpacing: "-2px",
							textAlign: "center",
							overflowWrap: "anywhere",
						}}
					>
						{label}
					</div>
				) : null}
			</div>
		</div>
	);
}
