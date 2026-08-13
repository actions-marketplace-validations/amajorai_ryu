// Standalone browser story for the composer's status line — the REAL
// `ComposerSettingsMenu` trigger, rendered from the same section shapes the
// composer hook builds.
//
// The trigger used to spell every setting out as its own bulleted segment
// (`Ryu · Claude Sonnet 4.5 · Accept edits · High`). It now compacts: the
// permission mode is its icon + colour, reasoning effort rides the model after
// an en dash, and the ACP harness sits in parentheses on the agent name. The
// composition rules are unit-tested (`composer-trigger-summary.test.ts`); what
// only a browser can answer is whether that verdict RENDERS — that the icon-only
// mode still paints an icon rather than an empty gap, and that dropping its word
// did not drop it from the accessible name too.
//
// The second mount is opencode's real shape, taken from an actual `opencode acp`
// probe: its `mode` config option is decorated (category `"mode"`) but its
// default value `build` matches no approval style, so it MUST keep its text —
// icon-only there would erase the setting from the bar.
//
// Hermetic: the menu is presentational, so no Core node, no Tauri, no context.

import { approvalModeStyle } from "@ryu/blocks/composer/composer-approval-style";
import { createRoot } from "react-dom/client";
import {
	ComposerSettingsMenu,
	type ComposerSettingsSection,
} from "../../components/agent-elements/input/composer-settings-menu.tsx";
import "../../src/index.css";

function noop() {
	return undefined;
}

/** The flagship's shape: agent + model + advertised approval modes + effort. */
const RYU_SECTIONS: ComposerSettingsSection[] = [
	{
		key: "agent",
		label: "Agent",
		ariaLabel: "Select agent",
		// What `useComposerAgentControls` composes: the agent name carrying its
		// harness, because "Ryu" alone never said which ACP agent is driving.
		activeName: "Ryu (pi)",
		items: [{ id: "ryu", name: "Ryu" }],
		value: "ryu",
		onChange: noop,
	},
	{
		key: "model",
		label: "Model",
		ariaLabel: "Select model",
		items: [{ id: "sonnet", name: "Claude Sonnet 4.5" }],
		value: "sonnet",
		onChange: noop,
	},
	{
		key: "approval",
		label: "Approval",
		ariaLabel: "Permission mode",
		decorate: approvalModeStyle,
		items: [
			{ id: "acceptEdits", name: "Accept edits" },
			{ id: "bypassPermissions", name: "Bypass permissions" },
		],
		value: "acceptEdits",
		onChange: noop,
	},
	{
		key: "cfg-thought_level",
		label: "Thinking",
		ariaLabel: "Reasoning effort",
		items: [
			{ id: "off", name: "Off" },
			{ id: "medium", name: "Medium" },
			{ id: "high", name: "High" },
		],
		value: "high",
		onChange: noop,
		variant: "slider",
	},
];

/** opencode's shape: a decorated mode option whose value resolves NO decoration. */
const OPENCODE_SECTIONS: ComposerSettingsSection[] = [
	{
		key: "agent",
		label: "Agent",
		ariaLabel: "Select agent",
		activeName: "OpenCode",
		items: [{ id: "acp:opencode", name: "OpenCode" }],
		value: "acp:opencode",
		onChange: noop,
	},
	{
		key: "cfg-mode",
		label: "Session Mode",
		ariaLabel: "Session Mode",
		decorate: approvalModeStyle,
		items: [
			{ id: "build", name: "Build" },
			{ id: "plan", name: "Plan" },
		],
		value: "build",
		onChange: noop,
	},
];

function Story() {
	return (
		<div className="flex min-h-screen flex-col gap-8 bg-background p-6">
			<section className="flex flex-col gap-2" data-testid="ryu">
				<h2 className="font-medium text-sm">Flagship</h2>
				<ComposerSettingsMenu sections={RYU_SECTIONS} />
			</section>
			<section className="flex flex-col gap-2" data-testid="opencode">
				<h2 className="font-medium text-sm">opencode</h2>
				<ComposerSettingsMenu sections={OPENCODE_SECTIONS} />
			</section>
			{/* The chat-with-history trigger, which names only the agent. The harness
			    rides along there too — it is part of the agent's NAME, not a fourth
			    segment — so compact reads `Ryu (pi)` and not a bare `Ryu`. Pinned
			    because that is the trigger a user looks at all day. */}
			<section className="flex flex-col gap-2" data-testid="ryu-compact">
				<h2 className="font-medium text-sm">Flagship (compact)</h2>
				<ComposerSettingsMenu compact sections={RYU_SECTIONS} />
			</section>
		</div>
	);
}

const container = document.getElementById("root");
if (container) {
	createRoot(container).render(<Story />);
}
