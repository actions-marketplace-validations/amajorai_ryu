import PageHeader from "@ryu/ui/components/page-header";
import { SuccessCheck } from "@ryu/ui/components/success-check";

export interface CheckoutSuccessProps {
	/** The Polar checkout id returned in the success redirect. */
	checkoutId?: string;
}

/**
 * The real post-checkout success page, presentational. The live route reads
 * the `checkout_id` search param and passes it in; the storyboard renders it
 * with a static id.
 */
export default function CheckoutSuccess({ checkoutId }: CheckoutSuccessProps) {
	return (
		<div className="flex flex-col items-start gap-8 px-4 py-8">
			<div className="flex size-20 items-center justify-center rounded-full bg-green-500">
				<SuccessCheck className="size-10 text-white" />
			</div>
			<PageHeader
				subtitle={checkoutId ? `Checkout ID: ${checkoutId}` : undefined}
				title="Payment Successful!"
			/>
		</div>
	);
}
