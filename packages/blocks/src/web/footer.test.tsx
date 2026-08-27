import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import Footer from "./footer.tsx";

test("footer uses the cursor-aware outline Ryu mark", () => {
	const html = renderToStaticMarkup(<Footer />);

	expect(html).toContain('data-testid="footer-ryu-logo"');
	expect(html).toContain('stroke="currentColor"');
	expect(html).not.toContain(">ryu</div>");
});
