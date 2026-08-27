"use client";

import {
	type PaymentSuccessKind,
	PaymentSuccessReceipt,
} from "./payment-success-receipt.tsx";

export interface CheckoutSuccessProps {
	/** The Polar checkout id used to seed the receipt details and barcode. */
	checkoutId?: string;
	/** The transaction family that controls the customer-facing copy. */
	kind?: PaymentSuccessKind;
}

/**
 * The shared post-checkout page. Polar returns plan, subscription, top-up, and
 * other hosted payments here; the cloud redirect remains a separate client
 * hand-off that runs before the receipt can become the final screen.
 */
export default function CheckoutSuccess({
	checkoutId,
	kind = "payment",
}: CheckoutSuccessProps) {
	return <PaymentSuccessReceipt checkoutId={checkoutId} kind={kind} />;
}
