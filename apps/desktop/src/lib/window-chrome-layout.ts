interface WindowChromeLayoutOptions {
	isMac: boolean;
	isMobile: boolean;
	nativeWindowChrome: boolean;
}

export interface WindowChromeLayout {
	navClusterPosition: string;
	navClusterReserve: string;
	pageActionsMargin: string;
}

export function windowChromeLayout({
	isMac,
	isMobile,
	nativeWindowChrome,
}: WindowChromeLayoutOptions): WindowChromeLayout {
	if (isMobile) {
		return {
			navClusterPosition: "top-2 left-2",
			navClusterReserve: "w-[4.5rem]",
			pageActionsMargin: "mr-2",
		};
	}

	const hasMacTrafficLights = nativeWindowChrome && isMac;
	const hasRightCaptionButtons = nativeWindowChrome && !isMac;

	return {
		navClusterPosition: hasMacTrafficLights ? "top-4 left-24" : "top-4 left-6",
		navClusterReserve: hasMacTrafficLights ? "w-48" : "w-40",
		pageActionsMargin: hasRightCaptionButtons ? "mr-48" : "mr-2",
	};
}
