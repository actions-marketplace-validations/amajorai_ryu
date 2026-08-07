"use client";

import { Button } from "@ryu/ui/components/button";
import { OTPInput } from "@ryu/ui/components/motion/otp-input";
import PageHeader from "@ryu/ui/components/page-header";
import { StaggerReveal } from "@ryu/ui/components/stagger-reveal";
import type { FormEvent, ReactNode } from "react";

/**
 * better-auth's device-authorization plugin issues 8 characters and displays
 * them as `XXXX-XXXX`; the hyphen is presentational, so the slots hold 8 and
 * `userCode` stays ungrouped.
 */
export const DEVICE_CODE_LENGTH = 8;
const DEVICE_CODE_GROUP = 4;

export interface DeviceActivateProps {
	/** Optional account switcher shown above the code form (device flow). */
	accountSwitcher?: ReactNode;
	/** Validation/verification error message. */
	error?: string | null;
	/** Verification request in flight. */
	isSubmitting?: boolean;
	/** Number of code slots. Defaults to the 8 better-auth issues. */
	length?: number;
	/** Fires once every slot is filled — the live route uses it to auto-submit. */
	onCodeComplete?: (value: string) => void;
	/** Form submit handler. */
	onSubmit?: (e: FormEvent) => void;
	/** Code input change handler — receives the ungrouped code. */
	onUserCodeChange?: (value: string) => void;
	/** The current device code value. */
	userCode?: string;
}

const noop = () => {
	// presentational default; the live app injects real handlers
};

/**
 * The real device-activation page, presentational. The live route owns the
 * authClient verify call, router redirect and session gating; the storyboard
 * renders it standalone with static state.
 */
export default function DeviceActivate({
	userCode = "",
	error = null,
	isSubmitting = false,
	length = DEVICE_CODE_LENGTH,
	onUserCodeChange = noop,
	onCodeComplete = noop,
	onSubmit = noop,
	accountSwitcher = null,
}: DeviceActivateProps) {
	return (
		<div className="flex min-h-[calc(100vh-5rem)] items-center justify-center px-4">
			<div className="w-full max-w-md space-y-8">
				{/* One clock for heading, account switcher and code form — see the
				    note in sign-in-form.tsx. `space-y-8` survives because
				    StaggerReveal renders its children in place with no wrapper. */}
				<StaggerReveal>
					<PageHeader
						stagger={false}
						subtitle="Enter the code displayed on your device to sign in"
						title="Activate device"
					/>

					{accountSwitcher}

					<form className="space-y-4" onSubmit={onSubmit}>
						<div className="flex justify-center">
							<OTPInput
								aria-label="Device activation code"
								autoFocus
								charset="alphanumeric"
								disabled={isSubmitting}
								errorMessage={error ?? undefined}
								groupSize={DEVICE_CODE_GROUP}
								hint="e.g. ABCD-1234"
								length={length}
								onChange={onUserCodeChange}
								onComplete={onCodeComplete}
								status={error ? "error" : "idle"}
								value={userCode}
							/>
						</div>
						<Button
							className="w-full"
							disabled={isSubmitting || userCode.length < length}
							size="lg"
							type="submit"
							variant="mono"
						>
							{isSubmitting ? "Verifying..." : "Continue"}
						</Button>
					</form>
				</StaggerReveal>
			</div>
		</div>
	);
}
