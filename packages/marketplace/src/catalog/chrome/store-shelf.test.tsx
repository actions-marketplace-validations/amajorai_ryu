import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import StoreShelf, { DEFAULT_SHELF_SIZE } from "./store-shelf.tsx";

function renderShelf(items: string[]) {
	return renderToStaticMarkup(
		<StoreShelf
			items={items}
			onOpenCategory={() => undefined}
			renderItem={(item) => (
				<span data-testid="item" key={item}>
					{item}
				</span>
			)}
			title="Search"
		/>
	);
}

describe("StoreShelf", () => {
	test("starts with eight cards and offers progressive expansion", () => {
		const html = renderShelf(
			Array.from({ length: DEFAULT_SHELF_SIZE + 1 }, (_, index) =>
				String(index + 1)
			)
		);

		expect(html.match(/data-testid="item"/g)).toHaveLength(DEFAULT_SHELF_SIZE);
		expect(html).toContain("Show more");
		expect(html).toContain('aria-label="Open Search"');
	});

	test("does not render expansion when the shelf is already complete", () => {
		const html = renderShelf(["one", "two"]);

		expect(html).not.toContain("Show more");
		expect(html.match(/data-testid="item"/g)).toHaveLength(2);
	});
});
