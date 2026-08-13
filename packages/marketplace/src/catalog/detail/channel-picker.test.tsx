// Unit tests for the release-train selector.
//
// Rendered to static markup (no DOM, no network), the same idiom as the other
// catalog render tests. The Select's *options* live in a portal and so are not
// emitted here; what these assert is the decision the component makes about
// whether to render a control at all, which is where the interesting rules are.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ChannelPicker,
	ChannelSwitchSummary,
	channelLabel,
} from "./channel-picker.tsx";

const noop = () => undefined;

describe("channelLabel", () => {
	test("labels the known trains the way the store's badges do", () => {
		expect(channelLabel("stable")).toBe("Stable");
		expect(channelLabel("beta")).toBe("Beta");
		expect(channelLabel("nightly")).toBe("Nightly");
		expect(channelLabel("rc")).toBe("Release candidate");
	});

	test("renders an author's own train name rather than dropping it", () => {
		// The channel set is deliberately open — a closed one would mean a client
		// release before anyone could ship an `edge` train.
		expect(channelLabel("edge")).toBe("Edge");
	});
});

describe("ChannelPicker", () => {
	test("renders nothing when there is only one train to be on", () => {
		// One option is not a choice: the control could only offer what would have
		// happened anyway.
		const markup = renderToStaticMarkup(
			<ChannelPicker
				channels={[{ channel: "stable", version: "1.4.0" }]}
				onChange={noop}
				value={null}
			/>
		);
		expect(markup).toBe("");
	});

	test("renders nothing when the channels could not be resolved", () => {
		// An empty list means "unknown", NOT "stable only" — a failed read must not
		// materialise into a picker that claims the listing ships one train.
		expect(
			renderToStaticMarkup(
				<ChannelPicker channels={[]} onChange={noop} value={null} />
			)
		).toBe("");
	});

	test("renders a selector once a second installable train exists", () => {
		const markup = renderToStaticMarkup(
			<ChannelPicker
				channels={[
					{ channel: "stable", installable: true, version: "1.4.0" },
					{ channel: "beta", installable: true, version: "1.5.0-beta.1" },
				]}
				onChange={noop}
				value={null}
			/>
		);
		expect(markup).not.toBe("");
	});

	test("ignores browse-only trains, which cannot be installed from", () => {
		// A repo-derived train describes what an author TAGGED. Offering it as a
		// selection would be a control whose choice silently does nothing.
		const markup = renderToStaticMarkup(
			<ChannelPicker
				channels={[
					{ channel: "stable", installable: false, version: "1.4.0" },
					{ channel: "beta", installable: false, version: "1.5.0-beta.1" },
				]}
				onChange={noop}
				value={null}
			/>
		);
		expect(markup).toBe("");
	});

	test("says out loud that the selected train is a prerelease", () => {
		const markup = renderToStaticMarkup(
			<ChannelPicker
				channels={[
					{ channel: "stable", installable: true, version: "1.4.0" },
					{ channel: "nightly", installable: true, version: "1.5.0-nightly.3" },
				]}
				onChange={noop}
				value="nightly"
			/>
		);
		expect(markup).toContain("Pre-release");
		// Naming the version matters: a prerelease can sit BEHIND stable, and the
		// number is the only thing that shows it.
		expect(markup).toContain("1.5.0-nightly.3");
	});

	test("carries no prerelease warning while stable is selected", () => {
		const markup = renderToStaticMarkup(
			<ChannelPicker
				channels={[
					{ channel: "stable", installable: true, version: "1.4.0" },
					{ channel: "beta", installable: true, version: "1.5.0-beta.1" },
				]}
				onChange={noop}
				value={null}
			/>
		);
		expect(markup).not.toContain("Pre-release");
	});
});

describe("ChannelSwitchSummary", () => {
	const trains = [
		{ channel: "stable", installable: true, version: "1.4.0" },
		{ channel: "beta", installable: true, version: "1.5.0-beta.1" },
		{ channel: "rc", installable: true, version: "1.4.0-rc.2" },
		{ channel: "canary", installable: true, version: null },
	];

	test("warns when the target train is BEHIND what is installed", () => {
		// `1.4.0-rc.2` sorts below `1.4.0` — the case the confirmation exists for.
		const markup = renderToStaticMarkup(
			<ChannelSwitchSummary
				channels={trains}
				installedVersion="1.4.0"
				target="rc"
			/>
		);
		expect(markup).toContain("OLDER");
		expect(markup).toContain("1.4.0-rc.2");
	});

	test("does not cry wolf when the target train is ahead", () => {
		const markup = renderToStaticMarkup(
			<ChannelSwitchSummary
				channels={trains}
				installedVersion="1.4.0"
				target="beta"
			/>
		);
		expect(markup).not.toContain("OLDER");
		expect(markup).toContain("1.5.0-beta.1");
	});

	test("says nothing will move for a train with no build yet", () => {
		// Following an empty train is a real choice — it is how you subscribe before
		// the first build — but it must not read as "you will be updated".
		const markup = renderToStaticMarkup(
			<ChannelSwitchSummary
				channels={trains}
				installedVersion="1.4.0"
				target="canary"
			/>
		);
		expect(markup).toContain("Nothing is published");
		expect(markup).toContain("stay on 1.4.0");
	});

	test("names stable when switching back with no target channel", () => {
		const markup = renderToStaticMarkup(
			<ChannelSwitchSummary
				channels={trains}
				installedVersion="1.5.0-beta.1"
				target={null}
			/>
		);
		expect(markup).toContain("Stable");
		expect(markup).toContain("1.4.0");
		// Stable 1.4.0 IS older than the 1.5.0-beta.1 they are on — the warning is
		// about precedence, not about which train is "better".
		expect(markup).toContain("OLDER");
	});
});
