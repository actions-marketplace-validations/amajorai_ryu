import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WaitlistQueue } from "./waitlist-queue.tsx";

const requiredProps = {
	handle: "",
	onChangeHandle: () => {},
	onCopyReferral: () => {},
	onReserve: () => {},
	onShare: () => {},
	onSignOut: () => {},
};

test("waitlist status can expose the community link beside account actions", () => {
	const html = renderToStaticMarkup(
		<WaitlistQueue
			{...requiredProps}
			discordHref="https://discord.gg/3RxeVyvdjG"
			loaded
			subtitle="Stay close to the queue."
		/>
	);

	expect(html).toContain("Join our Discord");
	expect(html).toContain('href="https://discord.gg/3RxeVyvdjG"');
	expect(html).toContain('target="_blank"');
	expect(html).toContain('rel="noopener noreferrer"');
});

test("waitlist status does not render an optional community link by default", () => {
	const html = renderToStaticMarkup(
		<WaitlistQueue
			{...requiredProps}
			loaded
			subtitle="Stay close to the queue."
		/>
	);

	expect(html).not.toContain("Join our Discord");
});
