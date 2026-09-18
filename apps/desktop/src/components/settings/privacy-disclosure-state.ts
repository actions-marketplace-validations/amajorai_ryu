// Shared first-run privacy disclosure state.
//
// The disclosure is presented in the final desktop onboarding step. This module
// keeps its acknowledgement and public documentation link available to Settings
// without owning a dialog or another visual surface.

export const DISCLOSURE_ACK_KEY = "ryu:privacy-disclosure-ack";
export const PRIVACY_DOCS_PATH = "/docs/surfaces/desktop/transparency";

/** True once the onboarding disclosure has been completed or acknowledged. */
export function isPrivacyDisclosureAcknowledged(): boolean {
	return localStorage.getItem(DISCLOSURE_ACK_KEY) === "true";
}

/** Persist the acknowledgement so Settings does not repeat the first-run notice. */
export function acknowledgePrivacyDisclosure(): void {
	localStorage.setItem(DISCLOSURE_ACK_KEY, "true");
}
