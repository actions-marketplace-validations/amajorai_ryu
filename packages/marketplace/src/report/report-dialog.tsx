// packages/marketplace/src/report/report-dialog.tsx
//
// Controlled dialog for filing a marketplace/app report. Reason pills + optional
// details. Submit is injected so desktop (bearer) and web (cookie) stay outside.

import { Button } from "@ryu/ui/components/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog.tsx";
import { Label } from "@ryu/ui/components/label.tsx";
import { Textarea } from "@ryu/ui/components/textarea.tsx";
import { useEffect, useState } from "react";
import { sileo } from "sileo";
import {
	REPORT_REASON_OPTIONS,
	type ReportReason,
	type ReportTarget,
	type SubmitReportInput,
	type SubmitReportResult,
} from "./types.ts";

const MAX_DETAILS = 2000;

export interface ReportDialogProps {
	onOpenChange: (open: boolean) => void;
	/** Surface-provided submit (desktop/web API client). */
	onSubmit: (
		input: SubmitReportInput
	) => Promise<SubmitReportResult | undefined>;
	open: boolean;
	target: ReportTarget | null;
}

export function ReportDialog({
	open,
	onOpenChange,
	target,
	onSubmit,
}: ReportDialogProps) {
	const [reason, setReason] = useState<ReportReason | null>(null);
	const [details, setDetails] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) {
			setReason(null);
			setDetails("");
			setBusy(false);
		}
	}, [open, target?.id, target?.kind]);

	const name = target?.itemName?.trim() || target?.id || "this item";
	const detailsRequired = reason === "other";
	const canSubmit =
		Boolean(target && reason) &&
		!(detailsRequired && details.trim().length === 0) &&
		!busy;

	const handleSubmit = async () => {
		if (!(target && reason)) {
			return;
		}
		setBusy(true);
		try {
			const result = await onSubmit({
				...target,
				reason,
				details: details.trim() || null,
			});
			onOpenChange(false);
			const issuesUrl = result?.suggestIssuesUrl?.trim() || null;
			if (issuesUrl && reason === "broken") {
				sileo.success({
					title: "Report submitted",
					description: issuesUrl
						? `Also consider filing upstream: ${issuesUrl}`
						: "Thanks — we'll look into it.",
				});
			} else {
				sileo.success({
					title: "Report submitted",
					description:
						reason === "malicious" ||
						reason === "spam" ||
						reason === "inappropriate" ||
						reason === "ip"
							? "Our team will review this shortly."
							: "Thanks — we'll look into it.",
				});
			}
		} catch (e) {
			const message =
				e instanceof Error ? e.message : "Could not submit report.";
			sileo.error({ title: message });
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Report {name}</DialogTitle>
					<DialogDescription>
						Tell us what's wrong. Security and abuse reports go to Ryu; quality
						issues on hosted listings also reach the publisher.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3">
					<fieldset className="flex flex-col gap-2">
						<Legend>Reason</Legend>
						<div className="flex flex-col gap-1.5">
							{REPORT_REASON_OPTIONS.map((opt) => {
								const selected = reason === opt.value;
								return (
									<button
										aria-pressed={selected}
										className={
											selected
												? "flex flex-col items-start gap-0.5 rounded-md border border-primary bg-primary/5 px-3 py-2 text-left transition-colors"
												: "flex flex-col items-start gap-0.5 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-muted/50"
										}
										key={opt.value}
										onClick={() => setReason(opt.value)}
										type="button"
									>
										<span className="font-medium text-sm">{opt.label}</span>
										<span className="text-muted-foreground text-xs">
											{opt.description}
										</span>
									</button>
								);
							})}
						</div>
					</fieldset>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor="report-details">
							Details{detailsRequired ? " (required)" : " (optional)"}
						</Label>
						<Textarea
							id="report-details"
							maxLength={MAX_DETAILS}
							onChange={(e) => setDetails(e.target.value)}
							placeholder="What happened? Include steps to reproduce if it's broken."
							rows={4}
							value={details}
						/>
						<span className="text-muted-foreground text-xs">
							{details.length}/{MAX_DETAILS}
						</span>
					</div>
				</div>

				<DialogFooter>
					<Button
						disabled={busy}
						onClick={() => onOpenChange(false)}
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						disabled={!canSubmit}
						onClick={() => {
							void handleSubmit();
						}}
						type="button"
					>
						{busy ? "Submitting…" : "Submit report"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function Legend({ children }: { children: React.ReactNode }) {
	return (
		<legend className="font-medium text-sm leading-none">{children}</legend>
	);
}
