import { expect, test } from "bun:test";
import {
	PRODUCT_NAV_GROUPS,
	PRODUCT_REALMS,
	productRealmsFor,
} from "./product-realms.ts";

test("the product realm keeps the public product names and destinations together", () => {
	expect(PRODUCT_REALMS.map((realm) => realm.id)).toEqual([
		"os",
		"bot",
		"console",
		"gateway",
		"connect",
		"passport",
		"box",
		"mail",
		"notify",
		"hire",
		"compute",
		"share",
	]);
	expect(PRODUCT_REALMS.map((realm) => realm.label)).toEqual([
		"Ryu OS",
		"Ryu Bot",
		"Ryu Console",
		"Ryu Gateway",
		"Ryu Connect",
		"Ryu Passport",
		"Ryu Box",
		"Ryu Mail",
		"Ryu Notify",
		"Ryu Hire",
		"Ryu Compute",
		"Ryu Share",
	]);
	for (const realm of PRODUCT_REALMS) {
		expect(realm.href.startsWith("/")).toBe(true);
		expect(realm.description.length).toBeGreaterThan(20);
	}
});

test("product navigation keeps the landing taxonomy in three groups", () => {
	expect(PRODUCT_NAV_GROUPS.map((group) => group.title)).toEqual([
		"Main Products",
		"Service APIs",
		"Capacity & Apps",
	]);
	expect(
		PRODUCT_NAV_GROUPS.map((group) =>
			productRealmsFor(group.ids).map((realm) => realm.id)
		)
	).toEqual([
		["os", "bot", "console"],
		["connect", "passport", "box", "mail", "notify"],
		["compute", "share", "hire"],
	]);
});
