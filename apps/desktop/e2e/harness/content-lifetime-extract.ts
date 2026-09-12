import { extractPageContext as realExtract } from "../../../extension/lib/page-extract.ts";
import { extracted } from "./content-lifetime-browser.ts";

export { currentSelection } from "../../../extension/lib/page-extract.ts";
export function extractPageContext() {
	extracted();
	return realExtract();
}
