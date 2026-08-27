import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { TooltipProvider } from "@ryu/ui/components/tooltip.tsx";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Bookmark } from "../../../../../apps-store/bookmarks/ui/src/types.ts";

if (typeof document === "undefined") {
	GlobalRegistrator.register();
}

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const nativeMatchMedia = window.matchMedia.bind(window);
Reflect.set(window, "matchMedia", (query: string) => {
	const result = nativeMatchMedia(query);
	if (query.includes("prefers-reduced-motion")) {
		Reflect.set(result, "matches", true);
	}
	return result;
});

const { BookmarkFolderGrid } = await import(
	"../../../../../apps-store/bookmarks/ui/src/BookmarkFolderGrid.tsx"
);

const bookmark: Bookmark = {
	createdAt: 1,
	description: "A durable interaction test",
	favorite: false,
	folder: "Research",
	id: "bookmark-1",
	tags: ["research"],
	title: "Ryu reference",
	updatedAt: 2,
	url: "https://example.com/ryu",
};

const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);

async function flushEffects(): Promise<void> {
	await act(async () => {
		await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
	});
}

function requiredButton(selector: string): HTMLButtonElement {
	const button = document.querySelector<HTMLButtonElement>(selector);
	if (!button) {
		throw new Error(`Missing bookmark action: ${selector}`);
	}
	return button;
}

afterAll(() => {
	act(() => root.unmount());
	container.remove();
	document.body.replaceChildren();
});

describe("BookmarkFolderGrid interactions", () => {
	test("expanded cards retain open, favorite, edit, and delete actions", async () => {
		const actions: string[] = [];
		act(() => {
			root.render(
				<TooltipProvider>
					<BookmarkFolderGrid
						collections={[
							{
								bookmarks: [bookmark],
								key: "folder:research",
								label: "Research",
							},
						]}
						onDelete={(item) => actions.push(`delete:${item.id}`)}
						onEdit={(item) => actions.push(`edit:${item.id}`)}
						onFavorite={(item) => actions.push(`favorite:${item.id}`)}
						onOpen={(item) => actions.push(`open:${item.id}`)}
					/>
				</TooltipProvider>
			);
		});

		act(() => requiredButton('button[aria-haspopup="dialog"]').click());
		await flushEffects();
		expect(document.querySelector('[role="dialog"]')).not.toBeNull();

		act(() => requiredButton(".card-title-button").click());
		act(() => requiredButton('button[aria-label="Add favorite"]').click());
		act(() =>
			requiredButton('button[aria-label="Edit Ryu reference"]').click()
		);
		act(() =>
			requiredButton('button[aria-label="Delete Ryu reference"]').click()
		);

		expect(actions).toEqual([
			"open:bookmark-1",
			"favorite:bookmark-1",
			"edit:bookmark-1",
			"delete:bookmark-1",
		]);
		expect(document.querySelector('[role="dialog"]')).not.toBeNull();
	});
});
