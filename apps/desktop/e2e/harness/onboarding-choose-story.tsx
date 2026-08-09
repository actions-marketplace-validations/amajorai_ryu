// Standalone browser story for the REAL onboarding `choose` fork — the first
// decision a new user makes (cloud / local / existing node), rendered straight
// from `@ryu/blocks/desktop/onboarding` with mock handlers.
//
// WHY IT NEEDS A BROWSER. The three options are a grid, not a column: cloud spans
// both columns on the first row, local and connect share the row under it. That
// layout only exists once the real Tailwind utilities resolve, and the cards are
// borderless `bg-muted` tiles — a fill that is 3% off the page background in
// light theme and 12% in dark. Whether they read as cards at all is a fact about
// resolved colour in each scheme, so both columns are rendered side by side.
//
// The local card is also the one that carries live install progress, so the third
// column pins the `localChecking` + `localProgress` state the real page enters
// after the "Run AI locally" pick.

import { OnboardingView } from "@ryu/blocks/desktop/onboarding";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

const HEADER = {
	title: "How do you want to run Ryu?",
	subtitle:
		"Run AI on this device, in the cloud, or on a node you already have",
};

function Column({
	dark,
	label,
	localChecking = false,
	localError,
	localUnreachable = false,
}: {
	dark: boolean;
	label: string;
	localChecking?: boolean;
	localError?: string;
	localUnreachable?: boolean;
}) {
	return (
		<div
			className={`${dark ? "dark" : ""} flex-1 bg-background text-foreground`}
			data-testid={`column-${label.toLowerCase().replace(/\s+/g, "-")}`}
		>
			<p className="p-4 font-medium text-muted-foreground text-xs uppercase tracking-widest">
				{label}
			</p>
			<OnboardingView
				isDesktop
				localChecking={localChecking}
				localError={localError ?? null}
				localUnreachable={localUnreachable}
				managedEntitled={false}
				step="choose"
				subtitle={HEADER.subtitle}
				title={HEADER.title}
			/>
		</div>
	);
}

/** The `installing` phase the local pick lands on. Its headline alternates
 *  between the flavour copy and the REAL state of the work — the two columns
 *  below are consecutive ticks of that same loop — and the bar carries the real
 *  download fraction. */
function Progress({
	dark,
	label,
	percent,
	status,
}: {
	dark: boolean;
	label: string;
	percent: number;
	status: string;
}) {
	return (
		<div
			className={`${dark ? "dark" : ""} flex-1 bg-background text-foreground`}
			data-testid={`column-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
		>
			<p className="p-4 font-medium text-muted-foreground text-xs uppercase tracking-widest">
				{label}
			</p>
			<OnboardingView
				isDesktop
				progress={percent}
				step="installing"
				title={status}
			/>
		</div>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<div className="flex min-h-screen">
		<Column dark={false} label="Light" />
		<Column dark label="Dark" />
		{/* Everything after the press happens on the `installing` phase — ONE
		    progress surface for the download, the boot and the local-stack wait,
		    rather than a second one bolted onto the card. The subtitle is the live
		    line and the bar is the real download fraction. */}
		<Progress
			dark
			label="Loop: flavour tick"
			percent={34}
			status="Installing the AI engine"
		/>
		<Progress
			dark
			label="Loop: real tick"
			percent={34}
			status="Downloading Ryu Core 35%"
		/>
		<Progress
			dark
			label="Loop: gateway tick"
			percent={49}
			status="Downloading the model gateway 30%"
		/>
		{/* The failure state must stay ONE cell: emitted as a sibling it would push
		    `connect` onto a third row and break the cloud-spans-row-one layout. */}
		<Column
			dark
			label="Failed"
			localError="download https://github.com/amajorai/ryu/releases/latest/download/ryu-core-macos-aarch64: HTTP 404"
			localUnreachable
		/>
	</div>
);
