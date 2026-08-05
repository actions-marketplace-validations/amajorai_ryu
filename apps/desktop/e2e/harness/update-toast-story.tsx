// Standalone browser story for the "update available" TOAST — the real sileo
// `Toaster` from `@ryu/ui`, fired with the real `updateToastBody(...)` over a
// real GitHub release body.
//
// Static markup is not enough to judge this one. The wrapper in
// `packages/ui/src/components/sileo.tsx` drives an `autopilot` expand/collapse
// cycle and a `duration`-clamped lifetime, and a toast is sized for one line of
// description — so whether a multi-line release-notes body actually stays
// EXPANDED and wraps is a browser question, not a React question. That is the
// whole point of the change (before it, the toast showed raw markdown source),
// so it gets a real Chromium check.
//
// No Core and no Tauri: the body is a checked-in copy of the v0.1.3 release
// notes, exactly as the GitHub API returns them.

import { Toaster } from "@ryu/ui/components/sileo.tsx";
import { createRoot } from "react-dom/client";
import { sileo } from "sileo";
import { updateToastBody } from "../../src/components/updater/ReleaseNotes.tsx";
import "../../src/index.css";

// Verbatim from `GET /repos/amajorai/ryu/releases/latest` — install section,
// pipe table, fenced blocks and all. Shortening it would remove exactly the
// content this story exists to prove gets dropped.
const RELEASE_BODY = `Built from commit \`386b482\`.

### Install

**Most people — the desktop app.** Download the installer for your OS from the assets below, or from https://ryuhq.com/download.

| macOS | Windows | Linux |
|---|---|---|
| \`.dmg\` (Apple Silicon) | \`.msi\` / \`.exe\` | \`.AppImage\` / \`.deb\` |

**Developers, self-hosters, servers — the headless stack** (\`ryu-core\`, \`ryu-gateway\`, \`ryu-cli\`) into \`~/.ryu/bin\`:

\`\`\`bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/amajorai/ryu/main/install.sh | sh
\`\`\`

Then \`ryu-cli\` — it starts a local Core on first run, no API key needed.

### Features

- quests overhaul, parallel web.search plugin, mesh networking settings, onboarding privacy (\`a7272cb\`)
- theme dither-kit, richer store catalog, academy questions, and app-store polish (\`e8be41f\`)

### Fixes

- **gateway**: allowlist the parallel plugin's two egress hosts (\`386b482\`)
- **release**: keep canary/nightly history, and stop losing changelogs (\`5d56516\`)

### Documentation

- **update**: correct release_version's account of how rolling tags are versioned (\`1e29270\`)

**Full changelog**: https://github.com/amajorai/ryu/compare/v0.1.2...v0.1.3`;

const LATEST = "0.1.3";

function show() {
	sileo.info({
		title: `Update available — v${LATEST}`,
		description: updateToastBody({
			notes: RELEASE_BODY,
			htmlUrl: `https://github.com/amajorai/ryu/releases/tag/v${LATEST}`,
			fallback: "A new version of Ryu is ready to install.",
		}),
		id: `ryu-update-${LATEST}`,
		duration: null,
		button: { title: "Update now", onClick: () => undefined },
	});
}

function Story() {
	return (
		<div className="p-10">
			<button
				className="rounded border px-3 py-1.5 text-sm"
				data-testid="show-toast"
				onClick={show}
				type="button"
			>
				Show update toast
			</button>
			<Toaster position="bottom-right" />
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
