import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import StoreCategoryPage from "./store-category-page.tsx";

describe("StoreCategoryPage", () => {
	test("renders a breadcrumb back action and the category cards", () => {
		const html = renderToStaticMarkup(
			<StoreCategoryPage
				category="Search"
				hasMore
				items={["one", "two"]}
				onBack={() => undefined}
				onLoadMore={() => undefined}
				renderItem={(item) => (
					<span data-testid="item" key={item}>
						{item}
					</span>
				)}
			/>
		);

		expect(html).toContain('aria-label="Back to categories"');
		expect(html).toContain('aria-current="page"');
		expect(html).toContain(">Search</span>");
		expect(html.match(/data-testid="item"/g)).toHaveLength(2);
	});
});
