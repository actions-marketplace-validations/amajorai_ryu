import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(import.meta.dir, "header.tsx"), "utf8");
const PRODUCTS_MENU = SOURCE.slice(
	SOURCE.indexOf("function ProductsMenu"),
	SOURCE.indexOf("function isHeaderLinkActive")
);
const MARKETING_LINKS = SOURCE.slice(
	SOURCE.indexOf("function HeaderLinkList"),
	SOURCE.indexOf("function PortalMobileNavigation")
);

test("marketing product menu participates in the shared hover morph", () => {
	expect(PRODUCTS_MENU).toContain("<MotionNavigationMenuTrigger");
	expect(PRODUCTS_MENU).toContain("<MotionNavigationMenuContent>");
	expect(PRODUCTS_MENU).not.toContain("<DropdownMenu>");
});

test("marketing product labels avoid repeating the Ryu prefix", () => {
	expect(SOURCE).toContain(
		"map(({ href, shortLabel }) => ({ href, label: shortLabel }))"
	);
	expect(SOURCE).toContain('{ href: "/marketplace/apps", label: "Apps" }');
	expect(SOURCE).toContain('label: "Cloud"');
	expect(SOURCE).toContain("Explore the platform →");
});

test("marketing marketplace link keeps the readable header treatment", () => {
	expect(MARKETING_LINKS).toContain(
		'"text-foreground hover:bg-muted hover:text-foreground"'
	);
	expect(MARKETING_LINKS).not.toContain(
		'"text-muted-foreground hover:bg-muted hover:text-foreground"'
	);
});
