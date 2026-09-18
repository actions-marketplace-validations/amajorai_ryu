/** Read a hosted app-first window target from the native/browser launch URL. */
export function readHostedStandaloneAppId(search: string): string {
	try {
		const params = new URLSearchParams(search);
		if (params.get("window") !== "standalone-app") {
			return "";
		}
		const appId = params.get("appId")?.trim() ?? "";
		return /^[a-zA-Z0-9@._/-]{1,200}$/.test(appId) &&
			!appId.startsWith("/") &&
			!appId.endsWith("/") &&
			!appId.includes("//") &&
			appId.split("/").every((segment) => segment !== "." && segment !== "..")
			? appId
			: "";
	} catch {
		return "";
	}
}
