// The onboarding privacy step. It is deliberately the same consent toggles the
// Settings → Privacy panel leads with (product analytics, community stats, crash
// reports, diagnostics export) driven through the *same* Core preferences and
// runtime gates, so whatever the user picks here is already persisted by the
// time onboarding finishes — there is no separate onboarding privacy state to
// reconcile later.
//
// Defaults match the §6 consent table: product analytics, community stats, and
// crash reports are opt-out (ON by default), diagnostics export is opt-in (OFF).
// Consent is still informed here — each row explains exactly what it sends — and
// every toggle flips the live runtime gate so a choice takes effect immediately.
//
// This unit ships the CONTROLS ONLY, exactly like PrivacySettings: no analytics
// SDK, crash reporter, or OTLP exporter is wired here.

import { Alert01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ONBOARDING_CONTENT_DELAY_MS } from "@ryu/blocks/desktop/onboarding";
import { Button } from "@ryu/ui/components/button";
import { Logo as GhostOrb } from "@ryu/ui/components/logo";
import { PageHeader } from "@ryu/ui/components/page-header";
import { toast } from "@ryu/ui/components/sileo";
import { StaggerReveal } from "@ryu/ui/components/stagger-reveal";
import { Switch } from "@ryu/ui/components/switch";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FRONTEND_URL } from "@/lib/auth-client.ts";
import { openExternal } from "@/lib/tauri-bridge.ts";
import { PRIVACY_DOCS_PATH } from "@/src/components/settings/privacy-disclosure.tsx";
import {
	SettingsCard,
	SettingsGroup,
	SettingsItem,
} from "@/src/components/settings/shared/settings-items.tsx";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { setAnalyticsEnabled } from "@/src/lib/analytics.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	getCommunityStatsEnabled,
	getCrashReportsEnabled,
	getDiagnosticsExportEnabled,
	getProductAnalyticsEnabled,
	setCommunityStatsEnabled,
	setCrashReportsEnabled,
	setDiagnosticsExportEnabled,
	setProductAnalyticsEnabled,
} from "@/src/lib/api/preferences.ts";
import { setCrashReportingEnabled } from "@/src/lib/crash.ts";

interface PrivacyStepProps {
	/** Onboarding is finishing; the step locks so the user can't double-submit. */
	busy?: boolean;
	onContinue: () => void;
}

export function PrivacyStep({ busy = false, onContinue }: PrivacyStepProps) {
	const activeNode = useActiveNode();
	// Memoize the target so it is stable across renders. A fresh object each
	// render would make the load effect (and every write callback) refire every
	// render, refetching all prefs and clobbering in-progress user input.
	const target: ApiTarget = useMemo(
		() => ({
			url: activeNode.url,
			token: activeNode.token ?? null,
		}),
		[activeNode.url, activeNode.token]
	);

	const [productAnalytics, setProductAnalytics] = useState(true);
	const [communityStats, setCommunityStats] = useState(true);
	const [crashReports, setCrashReports] = useState(true);
	const [diagnosticsExport, setDiagnosticsExport] = useState(false);

	useEffect(() => {
		let cancelled = false;
		Promise.all([
			getProductAnalyticsEnabled(target),
			getCommunityStatsEnabled(target),
			getCrashReportsEnabled(target),
			getDiagnosticsExportEnabled(target),
		])
			.then(([analytics, community, crashes, exportOn]) => {
				if (cancelled) {
					return;
				}
				setProductAnalytics(analytics);
				setCommunityStats(community);
				// Seed the runtime gates from the canonical Core prefs so the
				// in-memory flags + localStorage mirrors agree with what the user
				// chose (mirrors PrivacySettings).
				setAnalyticsEnabled(analytics);
				setCrashReports(crashes);
				setCrashReportingEnabled(crashes);
				setDiagnosticsExport(exportOn);
			})
			.catch(() => {
				// Leave the §6 defaults if Core's preferences can't be read yet.
			});
		return () => {
			cancelled = true;
		};
	}, [target]);

	const handleProductAnalytics = useCallback(
		async (next: boolean) => {
			setProductAnalytics(next);
			// Flip the live gate immediately so toggling off stops egress without
			// waiting on the async Core write.
			setAnalyticsEnabled(next);
			try {
				await setProductAnalyticsEnabled(target, next);
			} catch {
				setProductAnalytics(!next);
				setAnalyticsEnabled(!next);
				toast.error({
					title: "Couldn't save your analytics choice",
					description: "Check your connection and try again.",
				});
			}
		},
		[target]
	);

	const handleCommunityStats = useCallback(
		async (next: boolean) => {
			setCommunityStats(next);
			try {
				await setCommunityStatsEnabled(target, next);
			} catch {
				setCommunityStats(!next);
				toast.error({
					title: "Couldn't save your community-stats choice",
					description: "Check your connection and try again.",
				});
			}
		},
		[target]
	);

	const handleCrashReports = useCallback(
		async (next: boolean) => {
			setCrashReports(next);
			// Flip the live runtime gate immediately so toggling off stops egress
			// without waiting on the async Core write.
			setCrashReportingEnabled(next);
			try {
				await setCrashReportsEnabled(target, next);
			} catch {
				setCrashReports(!next);
				setCrashReportingEnabled(!next);
				toast.error({
					title: "Couldn't save your crash-report choice",
					description: "Check your connection and try again.",
				});
			}
		},
		[target]
	);

	const handleDiagnosticsExport = useCallback(
		async (next: boolean) => {
			setDiagnosticsExport(next);
			try {
				await setDiagnosticsExportEnabled(target, next);
			} catch {
				setDiagnosticsExport(!next);
				toast.error({
					title: "Couldn't save your diagnostics-export choice",
					description: "Check your connection and try again.",
				});
			}
		},
		[target]
	);

	// Open the published privacy/data page in the browser so the reference is a
	// real, followable link rather than a dead file path.
	const openDocs = useCallback(() => {
		Promise.resolve(openExternal(`${FRONTEND_URL}${PRIVACY_DOCS_PATH}`)).catch(
			() => undefined
		);
	}, []);

	return (
		// Mirrors the shared OnboardingShell: the outer box owns the scroll and the
		// inner column uses `min-h-full` so it centres when it fits and grows when it
		// doesn't (the page wrapper is `h-screen overflow-hidden`).
		<div className="scroll-fade h-full w-full overflow-y-auto">
			<div
				className="flex min-h-full w-full flex-col items-center justify-center gap-8 p-8"
				data-tauri-drag-region="true"
			>
				<StaggerReveal>
					<div className="shrink-0">
						<GhostOrb size="50px" variant="outline" />
					</div>
					<PageHeader
						stagger={false}
						subtitle="Choose what Ryu can send. You can change any of it later in Settings."
						title="Your privacy"
					/>
				</StaggerReveal>

				{/* The content picks the cascade back up where the header left it, so
				    the notice, the toggles and the Continue row arrive one after
				    another instead of as one block. Outside the reveal above on
				    purpose: revealing this column there AND its rows here would apply
				    the travel and the blur twice to the same rows. */}
				<div className="flex w-full max-w-md flex-col gap-6">
					<StaggerReveal startDelay={ONBOARDING_CONTENT_DELAY_MS} wrap>
						<SettingsCard className="flex flex-col gap-2.5 border-primary/40">
							<div className="flex items-start gap-2.5">
								<HugeiconsIcon
									className="mt-0.5 size-4 shrink-0 opacity-70"
									icon={Alert01Icon}
								/>
								<p className="text-muted-foreground text-xs leading-relaxed">
									Anonymous, content-free product analytics and crash reports
									are on by default so we can fix what breaks and improve the
									app. They never include your prompts, conversations, files, or
									any agent content, and they use a random install ID that is
									not linked to your account. Your local data plane sends
									nothing off your device unless you turn on diagnostics export.{" "}
									<button
										className="text-primary underline underline-offset-2"
										onClick={openDocs}
										type="button"
									>
										See our privacy &amp; data page
									</button>{" "}
									for the full breakdown.
								</p>
							</div>
						</SettingsCard>

						<SettingsGroup>
							<SettingsItem
								actions={
									<Switch
										checked={productAnalytics}
										id="onboarding-product-analytics"
										onCheckedChange={handleProductAnalytics}
									/>
								}
								description="Anonymous usage events (which screens you open, whether onboarding finished) help us improve Ryu. Never includes prompts, conversations, files, or any agent content."
								title="Product analytics"
							/>
							<SettingsItem
								actions={
									<Switch
										checked={communityStats}
										id="onboarding-community-stats"
										onCheckedChange={handleCommunityStats}
									/>
								}
								description="Anonymous, aggregate token-savings stats (request counts and tokens saved) so the community leaderboard reflects real usage."
								title="Community stats"
							/>
							<SettingsItem
								actions={
									<Switch
										checked={crashReports}
										id="onboarding-crash-reports"
										onCheckedChange={handleCrashReports}
									/>
								}
								description="Scrubbed crash and error stacks so we can fix what fails. No prompts or content."
								title="Crash reports"
							/>
							<SettingsItem
								actions={
									<Switch
										checked={diagnosticsExport}
										id="onboarding-diagnostics-export"
										onCheckedChange={handleDiagnosticsExport}
									/>
								}
								description="Export local run-trace and audit records over OpenTelemetry (OTLP) to an endpoint you choose in Settings. Off by default."
								title="Diagnostics export"
							/>
						</SettingsGroup>

						<div className="flex items-center justify-end">
							<Button
								disabled={busy}
								onClick={onContinue}
								size="lg"
								variant="mono"
							>
								{busy ? "Finishing…" : "Continue"}
							</Button>
						</div>
					</StaggerReveal>
				</div>
			</div>
		</div>
	);
}
