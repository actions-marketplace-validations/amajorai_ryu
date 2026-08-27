import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	type PaymentSuccessKind,
	PaymentSuccessReceipt,
} from "./payment-success-receipt.tsx";

test("prints a reusable top-up receipt without exposing the provider checkout id", () => {
	const checkoutId = "polar_checkout_test_123456";
	const html = renderToStaticMarkup(
		<PaymentSuccessReceipt checkoutId={checkoutId} kind="topup" />
	);

	expect(html).toContain('data-testid="payment-success-receipt"');
	expect(html).toContain("Top-up complete");
	expect(html).toContain("Being added");
	expect(html).toContain("RYU-");
	expect(html).not.toContain(checkoutId);
});

test("keeps every payment family on the shared receipt surface", () => {
	const kinds: PaymentSuccessKind[] = [
		"payment",
		"topup",
		"plan",
		"subscription",
		"upgrade",
		"purchase",
		"cloud",
	];

	for (const kind of kinds) {
		const html = renderToStaticMarkup(
			<PaymentSuccessReceipt checkoutId={`checkout-${kind}`} kind={kind} />
		);

		expect(html).toContain('data-testid="payment-success-receipt"');
		expect(html).toContain("paid");
	}
});
