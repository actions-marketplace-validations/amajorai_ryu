import { expect, test } from "bun:test";
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
