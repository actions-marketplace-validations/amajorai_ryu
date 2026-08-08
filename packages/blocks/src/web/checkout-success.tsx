import PageHeader from "@ryu/ui/components/page-header";
import { SuccessCheck } from "@ryu/ui/components/success-check";

export interface CheckoutSuccessProps {
	/**
	 * The Polar checkout id returned in the success redirect.
	 *
	 * Accepted and deliberately NOT rendered. It used to print as the page's
	 * subtitle, which put a raw `cs_test_a1B2…` under "Payment successful" — the
	 * one line a customer reads at the moment a payment clears, spent on an
	 * identifier that means nothing to them and that support has never asked for.
	 * Kept on the interface because the route passes it and it is the natural
	 * handle for anything this page later needs to look up.
	 */
	checkoutId?: string;
}

/**
 * The real post-checkout success page, presentational. The live route reads the
 * `checkout_id` search param and passes it in; the storyboard renders it with a
 * static id.
 *
 * Laid out as `device-activate.tsx` is, and for the same reason: both are
 * single-purpose arrival screens a user is redirected to with nothing else on
 * them, so the content is centred in the viewport rather than sitting in the
 * top-left of an otherwise empty page. The `5rem` deduction is the site header
 * these routes render beneath.
 */
export default function CheckoutSuccess({
	checkoutId: _checkoutId,
}: CheckoutSuccessProps) {
	return (
		<div className="flex min-h-[calc(100vh-5rem)] items-center justify-center px-4">
			{/* The COLUMN is centred in the viewport; the text inside it stays
			    left-aligned. That is the pattern `device-activate.tsx` sets for these
			    arrival screens, and the two halves are easy to conflate: centring the
			    type as well turns a heading and its explanation into a pair of ragged
			    lines with no shared edge to read down. */}
			<div className="flex w-full max-w-md flex-col gap-8">
				<div className="flex size-20 items-center justify-center rounded-full bg-green-500">
					<SuccessCheck className="size-10 text-white" />
				</div>
				<PageHeader
					subtitle="Your payment went through and your plan is now active."
					title="Payment successful"
				/>
			</div>
		</div>
	);
}
