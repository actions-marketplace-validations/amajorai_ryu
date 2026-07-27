// packages/marketplace/src/report/types.ts
//
// Shared types for reporting a marketplace / catalog / installed item. Surfaces
// (desktop + web) submit through their own API clients; this package only owns
// the dialog chrome and reason catalogue.

/** Preset report reasons — keep in sync with packages/db marketplaceReport. */
export const REPORT_REASONS = [
	"malicious",
	"spam",
	"inappropriate",
	"ip",
	"broken",
	"other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_SOURCES = [
	"mongo",
	"github-curated",
	"github-community",
	"installed",
	"unknown",
] as const;

export type ReportSource = (typeof REPORT_SOURCES)[number];

export interface ReportTarget {
	homepage?: string | null;
	id: string;
	installSource?: string | null;
	/** Display name shown in the dialog title. */
	itemName?: string | null;
	kind: string;
	source?: ReportSource;
}

export interface SubmitReportInput extends ReportTarget {
	details?: string | null;
	reason: ReportReason;
}

export interface SubmitReportResult {
	suggestIssuesUrl?: string | null;
}

export interface ReportReasonOption {
	description: string;
	label: string;
	/** Trust & safety — routed to platform admins only. */
	platformOnly: boolean;
	value: ReportReason;
}

export const REPORT_REASON_OPTIONS: ReportReasonOption[] = [
	{
		value: "malicious",
		label: "Malicious or unsafe",
		description:
			"Malware, data theft, unexpected network access, or other security risk.",
		platformOnly: true,
	},
	{
		value: "spam",
		label: "Spam or misleading",
		description: "Fake listing, scam, or deliberately misleading description.",
		platformOnly: true,
	},
	{
		value: "inappropriate",
		label: "Inappropriate content",
		description: "Offensive, abusive, or otherwise inappropriate material.",
		platformOnly: true,
	},
	{
		value: "ip",
		label: "Copyright or IP issue",
		description: "Infringes trademarks, copyrights, or other rights.",
		platformOnly: true,
	},
	{
		value: "broken",
		label: "Not working",
		description:
			"Crashes, fails to install, or does not work as described. Sellers see these when the listing is hosted on Ryu.",
		platformOnly: false,
	},
	{
		value: "other",
		label: "Something else",
		description: "Any other concern — please describe it below.",
		platformOnly: false,
	},
];
