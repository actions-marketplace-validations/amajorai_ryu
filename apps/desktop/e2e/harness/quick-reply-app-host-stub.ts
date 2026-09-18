// The quick-reply story does not mount plugin companions. Keep its dependency
// graph isolated when another concurrent checkout change temporarily makes the
// host's sandbox document builder unparseable.
export function htmlCompanionSrcdoc(..._args: unknown[]): string {
	return "";
}

export function thirdPartyPluginSrcdoc(..._args: unknown[]): string {
	return "";
}
