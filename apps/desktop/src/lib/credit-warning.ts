/**
 * The sidebar's low-credit rule for managed inference.
 *
 * The balance is an organization wallet. The subscription's included monthly
 * pool gives the desktop a stable denominator for a useful percentage; top-ups
 * may push the displayed percentage above that pool, so the result is capped at
 * 100%.
 */

/** Show a warning when at most this much of the included pool remains. */
export const LOW_CREDIT_REMAINING_PERCENT = 20;

export interface CreditBalanceInput {
	balanceMicroUsd: number;
	monthlyCreditPoolMicroUsd: number;
}

export type CreditBalanceStatus =
	| { kind: "empty"; remainingPercent: 0 }
	| { kind: "healthy"; remainingPercent: number | null }
	| { kind: "low"; remainingPercent: number };

/**
 * Classify one org-wallet balance for the sidebar.
 *
 * A plan without an included pool can still have a positive PAYG balance, but
 * it has no honest subscription percentage. It therefore stays healthy with a
 * null percentage until the wallet reaches zero.
 */
export function creditBalanceStatus(
	input: CreditBalanceInput
): CreditBalanceStatus {
	const balance = Number.isFinite(input.balanceMicroUsd)
		? Math.max(0, input.balanceMicroUsd)
		: 0;
	if (balance <= 0) {
		return { kind: "empty", remainingPercent: 0 };
	}

	const monthlyPool = Number.isFinite(input.monthlyCreditPoolMicroUsd)
		? Math.max(0, input.monthlyCreditPoolMicroUsd)
		: 0;
	if (monthlyPool <= 0) {
		return { kind: "healthy", remainingPercent: null };
	}

	const remainingPercent = Math.min(
		100,
		Math.max(0, Math.round((balance / monthlyPool) * 100))
	);
	return remainingPercent <= LOW_CREDIT_REMAINING_PERCENT
		? { kind: "low", remainingPercent }
		: { kind: "healthy", remainingPercent };
}

