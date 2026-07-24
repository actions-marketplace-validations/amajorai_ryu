// packages/marketplace/src/catalog/plugin-id.ts
//
// Display formatting for reverse-DNS plugin ids, shared by the catalog list and
// the detail tabs. Lives on its own so both can use it without the detail panels
// importing back into the section that renders them.

/** Prettify a plugin id ("com.ryu.spaces" → "Spaces") for display. */
export function prettyPluginId(id: string): string {
	const leaf = id.split(".").pop() ?? id;
	return leaf.charAt(0).toUpperCase() + leaf.slice(1);
}
