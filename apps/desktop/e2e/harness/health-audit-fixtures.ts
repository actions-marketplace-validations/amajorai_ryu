/** Controlled transport fixtures; never used by production bundles. */
export const assessment = {
	score: 78,
	confidence: "medium",
	summary:
		"The configuration is usable, with a few safeguards worth tightening.",
	evidence: [
		"The snapshot declares network access and provides documented configuration.",
	],
	recommendations: [
		{
			priority: "medium",
			action: "Narrow access to the sources this task needs",
			reason: "A smaller capability scope reduces unintended actions.",
		},
	],
	limitations: [
		"Snapshot analysis only; no live runtime or connectivity checks were executed.",
	],
};
export const doctor = {
	counts: { errors: 0, warnings: 1, info: 0 },
	generatedAt: 1_788_884_000,
	reachable: true,
	readOnly: true,
	posture: "balanced",
	rulesetVersion: "gateway-doctor-1",
	findings: [
		{
			checkId: "coverage.codex",
			category: "coverage",
			severity: "warning",
			canAutoFix: false,
			summary: "Codex traffic is outside Gateway coverage",
			detail: "Direct agent requests do not pass through Gateway controls.",
			recommendedAction: "Review the agent routing configuration.",
		},
	],
};
