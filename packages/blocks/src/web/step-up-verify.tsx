"use client";

import {
	isFreeTextCode,
	STEP_UP_CODE_LENGTH,
	STEP_UP_METHOD_LABEL,
	type StepUpMethod,
} from "@ryu/step-up";
import { Button } from "@ryu/ui/components/button";
import { Input } from "@ryu/ui/components/input";
import { OTPInput, type OTPStatus } from "@ryu/ui/components/motion/otp-input";
import type { FormEvent } from "react";

/**
 * The step-up ("confirm it's you") code form, presentational.
 *
 * Same shape as the device-activation page — heading, one row of slots, one
 * full-width primary button — because a person who has entered a code here once
 * should recognise the next one on sight. What differs is what it sits in: this
 * one is rendered inside a dialog over the thing you were about to do, so it
 * carries no page chrome and no account switcher, and it names the action
 * instead of the device.
 *
 * The live dialog owns the verify call, the method switching and the retry; this
 * renders state it is handed, so the storyboard can show every branch.
 */

/**
 * Codes we ask for: authenticator, emailed code, printed recovery code. Aliased
 * from `@ryu/step-up` so the wire contract, the slot widths and this component
 * cannot drift apart.
 */
export type StepUpMethodChoice = StepUpMethod;

export interface StepUpVerifyProps {
	/** The code the user has typed. */
	code?: string;
	/** Rejection message shown under the slots. */
	error?: string | null;
	/** Verification in flight. */
	isSubmitting?: boolean;
	/** Which factor is being entered. */
	method?: StepUpMethodChoice;
	/** Code change handler. */
	onCodeChange?: (value: string) => void;
	/** Fires once every slot is filled — the live dialog auto-submits on it. */
	onCodeComplete?: (value: string) => void;
	/** Fires when one of `otherMethods` is picked. */
	onMethodChange?: (method: StepUpMethodChoice) => void;
	/** Re-send the emailed code. Omit when email is not on offer. */
	onResend?: () => void;
	/** Form submit handler. */
	onSubmit?: (e: FormEvent) => void;
	/** The other factors on offer, rendered as switch links under the button. */
	otherMethods?: StepUpMethodChoice[];
	/** True once the code cleared, so the slots can draw their check. */
	status?: OTPStatus;
}

const noop = () => {
	// presentational default; the live dialog injects real handlers
};

export default function StepUpVerify({
	code = "",
	error = null,
	isSubmitting = false,
	method = "totp",
	onCodeChange = noop,
	onCodeComplete = noop,
	onMethodChange = noop,
	onResend,
	onSubmit = noop,
	otherMethods = [],
	status = "idle",
}: StepUpVerifyProps) {
	const length = STEP_UP_CODE_LENGTH[method];
	const freeText = isFreeTextCode(method);
	// A slot grid is only submittable when every slot is filled; a free-text
	// backup code just has to be non-empty, since its printed form varies.
	const ready = freeText ? code.trim().length > 0 : code.length >= length;
	return (
		// One instruction line only, carried by the dialog's own description —
		// the device-activation page it mirrors puts that line in the header
		// subtitle rather than repeating it above the slots.
		<form className="space-y-4" onSubmit={onSubmit}>
			{freeText ? (
				// A backup code is mixed-case and hyphenated (`xxxxx-xxxxx`), and the
				// slot grid normalizes to upper-case alphanumerics — it would quietly
				// mangle every one of them. Same reason the sign-in 2FA page keeps
				// backup codes on a plain field.
				<Input
					aria-label="Backup code"
					autoFocus
					className="text-center font-mono text-2xl"
					disabled={isSubmitting}
					inputMode="text"
					maxLength={length}
					onChange={(e) => onCodeChange(e.target.value)}
					placeholder="xxxxx-xxxxx"
					type="text"
					value={code}
				/>
			) : (
				<div className="flex justify-center">
					<OTPInput
						aria-label="Confirmation code"
						autoFocus
						disabled={isSubmitting}
						errorMessage={error ?? undefined}
						// Remounts on a method switch so the slot count changes cleanly
						// instead of half-applying.
						key={method}
						length={length}
						onChange={onCodeChange}
						onComplete={onCodeComplete}
						status={error ? "error" : status}
						successMessage="Verified."
						value={code}
					/>
				</div>
			)}
			{freeText && error ? (
				<p className="text-destructive text-sm">{error}</p>
			) : null}

			<Button
				className="w-full"
				disabled={isSubmitting || !ready}
				size="lg"
				type="submit"
				variant="mono"
			>
				{isSubmitting ? "Verifying..." : "Confirm"}
			</Button>

			{(otherMethods.length > 0 || onResend) && (
				<div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
					{method === "otp" && onResend ? (
						<Button
							disabled={isSubmitting}
							onClick={onResend}
							size="sm"
							type="button"
							variant="ghost"
						>
							Send it again
						</Button>
					) : null}
					{otherMethods.map((other) => (
						<Button
							disabled={isSubmitting}
							key={other}
							onClick={() => onMethodChange(other)}
							size="sm"
							type="button"
							variant="ghost"
						>
							{STEP_UP_METHOD_LABEL[other]}
						</Button>
					))}
				</div>
			)}
		</form>
	);
}
