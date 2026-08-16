// Smoke test for the generative-UI chain: an agent spec → json-render Renderer →
// the project's `@ryu/ui` components. Renders to static markup (no DOM) and asserts
// the real component output, the inline fallback for an unknown component type, and
// the whole-spec fallback that keeps a structurally-broken spec from crashing chat.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentUI, createAgentUiActionHandlers } from "./agent-ui.tsx";

const sampleSpec = {
	root: "card",
	elements: {
		card: {
			type: "Card",
			props: { title: "Deploy status" },
			children: ["body"],
		},
		body: {
			type: "Stack",
			props: { gap: "sm" },
			children: ["msg", "bar", "badge"],
		},
		msg: {
			type: "Text",
			props: { text: "Building…", muted: true },
			children: [],
		},
		bar: { type: "Progress", props: { value: 60 }, children: [] },
		badge: { type: "Badge", props: { text: "running" }, children: [] },
	},
};

describe("AgentUI", () => {
	test("forwards submit action values to the host callback", async () => {
		const values: unknown[] = [];
		const handlers = createAgentUiActionHandlers((value) => values.push(value));

		await handlers.submit({ value: { choice: "approve" } });

		expect(values).toEqual([{ choice: "approve" }]);
	});

	test("does not invoke a missing host callback", async () => {
		const handlers = createAgentUiActionHandlers();
		await expect(
			handlers.submit({ value: "ignored" })
		).resolves.toBeUndefined();
	});

	test("renders the spec into @ryu/ui components", () => {
		const html = renderToStaticMarkup(<AgentUI spec={sampleSpec} />);
		expect(html).toContain("Deploy status");
		expect(html).toContain("Building…");
		expect(html).toContain("running");
		// A real @ryu/ui Card carries the shadcn token class.
		expect(html).toContain("bg-card");
	});

	test("renders an optional title above the UI", () => {
		const html = renderToStaticMarkup(
			<AgentUI spec={sampleSpec} title="Status" />
		);
		expect(html).toContain("Status");
	});

	test("renders an unknown component type inertly instead of throwing", () => {
		const spec = {
			root: "x",
			elements: { x: { type: "NotAComponent", props: {}, children: [] } },
		};
		const html = renderToStaticMarkup(<AgentUI spec={spec} />);
		expect(html).toContain("unknown component");
		expect(html).toContain("NotAComponent");
	});

	test("renders the safe gallery components", () => {
		const spec = {
			root: "stack",
			elements: {
				stack: {
					type: "Stack",
					props: { gap: "sm" },
					children: ["options", "approval", "link"],
				},
				options: {
					type: "OptionList",
					props: {
						label: "Environment",
						value: "staging",
						options: [
							{ label: "Staging", value: "staging" },
							{ label: "Production", value: "production" },
						],
					},
					children: [],
				},
				approval: {
					type: "ApprovalCard",
					props: { title: "Ship release?" },
					children: [],
				},
				link: {
					type: "LinkPreview",
					props: {
						title: "Release notes",
						href: "https://example.com/releases",
					},
					children: [],
				},
			},
		};
		const html = renderToStaticMarkup(<AgentUI spec={spec} />);

		expect(html).toContain("Environment");
		expect(html).toContain("Ship release?");
		expect(html).toContain("Release notes");
		expect(html).toContain('href="https://example.com/releases"');
	});

	test("renders unsafe link previews inertly", () => {
		const spec = {
			root: "link",
			elements: {
				link: {
					type: "LinkPreview",
					props: { title: "Unsafe", href: "javascript:alert(1)" },
					children: [],
				},
			},
		};
		const html = renderToStaticMarkup(<AgentUI spec={spec} />);

		expect(html).toContain('href="#"');
		expect(html).not.toContain("javascript:");
	});

	test("falls back to raw JSON for a structurally-broken spec", () => {
		const html = renderToStaticMarkup(<AgentUI spec={{ not: "a spec" }} />);
		expect(html.toLowerCase()).toContain("be rendered");
		expect(html).toContain("not");
	});
});
