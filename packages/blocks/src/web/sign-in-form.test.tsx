import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import SignInForm from "./sign-in-form.tsx";

test("secondary sign-in methods live under More options", () => {
	const html = renderToStaticMarkup(
		<SignInForm
			onForgotPassword={() => undefined}
			onGoogle={() => undefined}
			onPasskey={() => undefined}
			onSSO={() => undefined}
			onSwitchToSignUp={() => undefined}
			onToggleMagicLink={() => undefined}
			showForgotPassword
		/>
	);

	expect(html).toContain("More options");
	expect(html).toContain('data-slot="accordion"');
});
