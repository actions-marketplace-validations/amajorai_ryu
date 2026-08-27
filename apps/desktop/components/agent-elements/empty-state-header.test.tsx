import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module(
	"@/components/agent-elements/input/composer-settings-menu.tsx",
	() => ({ ComposerSettingsMenu: () => null })
);
mock.module(
	"@/components/agent-elements/input/manage-models-button.tsx",
	() => ({ ManageModelsButton: () => null })
);
mock.module("@/src/components/chat/ProjectPicker.tsx", () => ({
	ProjectPickerContent: () => null,
}));
mock.module("@/src/lib/agent-logos.tsx", () => ({ AgentLogo: () => null }));
mock.module("@/src/store/useWorkspaceStore.ts", () => ({
	useWorkspaceStore: () => ({ folder: "/Users/ryu/Documents/Code/ryu" }),
}));

const { EmptyStateHeader } = await import("./empty-state-header.tsx");

describe("EmptyStateHeader folder trigger", () => {
	test("uses a dotted link treatment without a hover background", () => {
		const html = renderToStaticMarkup(
			<EmptyStateHeader
				logo={{ kind: "single", engine: "ryu" }}
				sections={[]}
			/>
		);
		const trigger = html.match(
			/<button[^>]*aria-label="Select project folder"[^>]*>/
		)?.[0];

		expect(trigger).toBeDefined();
		expect(trigger).toContain("underline");
		expect(trigger).toContain("decoration-dotted");
		expect(trigger).toContain("hover:bg-transparent");
		expect(trigger).toContain("hover:text-muted-foreground");
		expect(trigger).not.toContain("hover:bg-muted");
	});
});
