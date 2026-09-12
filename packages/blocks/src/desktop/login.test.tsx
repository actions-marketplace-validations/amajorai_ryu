import { expect, test } from "bun:test";
import { I18nProvider } from "@ryu/i18n/react";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginView } from "./login.tsx";

test("keeps Core download promotion off the browser welcome screen", () => {
	const html = renderToStaticMarkup(
		<LoginView onContinueAsGuest={() => undefined} />
	);

	expect(html).toContain("Try Ryu without an account");
	expect(html).not.toContain("Download Ryu Core for this computer");
	expect(html).not.toContain("standalone local runtime");
});

test("omits the guest action when the host disables guest mode", () => {
	const html = renderToStaticMarkup(<LoginView />);

	expect(html).not.toContain("Try Ryu without an account");
});

test("localizes the welcome copy through the shared catalog", () => {
	const html = renderToStaticMarkup(
		<I18nProvider initialPackId="official/es">
			<LoginView onContinueAsGuest={() => undefined} />
		</I18nProvider>
	);

	expect(html).toContain("Hola, soy Ryu");
	expect(html).toContain("Tu fantasma amigable que vive en tu escritorio");
	expect(html).toContain("Comenzar");
	expect(html).toContain("Probar Ryu sin una cuenta");
	expect(html).not.toContain("Hey, I'm Ryu");
});
