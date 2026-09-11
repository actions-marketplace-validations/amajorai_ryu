import { describe, expect, test } from "bun:test";
import {
	type DesignSystemEvidence,
	designSystemChecks,
	runDesignSystemScorecard,
} from "./design-system-scorecard.ts";

const compliantEvidence: DesignSystemEvidence = {
	files: [
		{
			contents: '@import "@ryu/ui/app-ui.css";',
			path: "ui/src/styles.css",
		},
		{
			contents: [
				'import { markCompanionAppRoot, subscribeCompanionTheme } from "@ryu/app-host/companion-theme";',
				'import { RyuAppShell } from "@ryu/blocks/companion/app-ui";',
				'markCompanionAppRoot(document.getElementById("root"));',
				"subscribeCompanionTheme();",
			].join("\n"),
			path: "ui/src/main.tsx",
		},
		{
			contents: [
				'import { Button, Empty, Spinner } from "@ryu/ui/components";',
				'<RyuAppShell className="bg-background text-foreground">',
				'<Button aria-label="Save" disabled={loading}>Save</Button>',
				"{loading ? <Spinner /> : null}",
				"{empty ? <Empty /> : null}",
				"{error ? <p>Unable to load</p> : null}",
				"</RyuAppShell>",
			].join("\n"),
			path: "ui/src/App.tsx",
		},
		{
			contents: '<div className="border-border ring-ring" />',
			path: "ui/src/preview.tsx",
		},
	],
	navigation: "manifest",
};

function statusOf(input: ReturnType<typeof designSystemChecks>, id: string) {
	return input.find((check) => check.id === id)?.status;
}

describe("Ryu design-system scorecard", () => {
	test("does not infer compliance when a UI listing has no source evidence", () => {
		const checks = designSystemChecks({
			surface: "companion",
		});

		expect(checks).toHaveLength(1);
		expect(checks[0]?.status).toBe("unknown");
		expect(checks[0]?.detail).toContain("not treated as compliant");
	});

	test("passes a Companion that uses the shell, theme, primitives, and states", () => {
		const scorecard = runDesignSystemScorecard({
			evidence: compliantEvidence,
			surface: "companion",
		});

		expect(scorecard.rulesetVersion).toBe("design-system-1");
		expect(scorecard.grade).toBe("A");
		expect(scorecard.checks.every((check) => check.status === "pass")).toBe(
			true
		);
	});

	test("flags local control copies, raw colors, missing names, and unguarded motion", () => {
		const checks = designSystemChecks({
			evidence: {
				files: [
					{
						contents: [
							"export function Button() { return <button style={{ color: '#ff0000', fontFamily: 'Arial', borderRadius: '3px' }}>Save</button>; }",
							'<div className="transition-all" />',
						].join("\n"),
						path: "ui/src/App.tsx",
					},
				],
			},
			surface: "companion",
		});

		expect(statusOf(checks, "app-shell")).toBe("fail");
		expect(statusOf(checks, "theme-contract")).toBe("fail");
		expect(statusOf(checks, "shared-primitives")).toBe("warn");
		expect(statusOf(checks, "semantic-tokens")).toBe("fail");
		expect(statusOf(checks, "typography-shapes")).toBe("warn");
		expect(statusOf(checks, "accessible-states")).toBe("fail");
		expect(statusOf(checks, "reduced-motion")).toBe("warn");
	});

	test("keeps non-UI plugins out of the design-system grade", () => {
		const checks = designSystemChecks({ surface: "none" });

		expect(checks).toHaveLength(1);
		expect(checks[0]?.status).toBe("unknown");
		expect(checks[0]?.detail).toContain("not applicable");
	});
});
