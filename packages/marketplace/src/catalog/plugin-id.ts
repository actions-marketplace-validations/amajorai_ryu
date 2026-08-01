// packages/marketplace/src/catalog/plugin-id.ts
//
// Display formatting for reverse-DNS plugin ids, shared by the catalog list and
// the detail tabs. Lives on its own so both can use it without the detail panels
// importing back into the section that renders them.

/**
 * Prettify a plugin id ("@ryu/spaces" → "Spaces") for display.
 *
 * Two id shapes reach this: the scoped form (`@ryu/spaces`), where the name is
 * everything after the `/`, and the legacy reverse-DNS form (`com.ryu.spaces`),
 * where it is the last dotted segment. Take the scope half off first — a dotted
 * split alone leaves a scoped id untouched (it has no `.`) and the raw id would
 * be rendered as the display name.
 */
export function prettyPluginId(id: string): string {
	const unscoped = id.startsWith("@") ? (id.split("/").pop() ?? id) : id;
	const leaf = unscoped.split(".").pop() ?? unscoped;
	return leaf.charAt(0).toUpperCase() + leaf.slice(1);
}
