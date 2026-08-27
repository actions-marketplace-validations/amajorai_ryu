import { createContext, type ReactNode, useContext, useMemo } from "react";

export type AppSurface = "desktop" | "web" | "extension" | "mobile";

export const APP_SURFACES: readonly AppSurface[] = [
	"desktop",
	"web",
	"extension",
	"mobile",
];

export interface AppSurfaceCapabilities {
	canManageDesktopLifecycle: boolean;
	canOpenNativeWindows: boolean;
	canUpdateDesktopApp: boolean;
	canUseNativeShell: boolean;
	isDesktop: boolean;
	nativeWindowChrome: boolean;
	surface: AppSurface;
}

const DESKTOP_CAPABILITIES = {
	canManageDesktopLifecycle: true,
	canOpenNativeWindows: true,
	canUpdateDesktopApp: true,
	canUseNativeShell: true,
	isDesktop: true,
	nativeWindowChrome: true,
	surface: "desktop",
} satisfies AppSurfaceCapabilities;

const BROWSER_CAPABILITIES = {
	canManageDesktopLifecycle: false,
	canOpenNativeWindows: false,
	canUpdateDesktopApp: false,
	canUseNativeShell: false,
	isDesktop: false,
	nativeWindowChrome: false,
} satisfies Omit<AppSurfaceCapabilities, "surface">;

const CAPABILITIES_BY_SURFACE = {
	desktop: DESKTOP_CAPABILITIES,
	extension: { ...BROWSER_CAPABILITIES, surface: "extension" },
	mobile: { ...BROWSER_CAPABILITIES, surface: "mobile" },
	web: { ...BROWSER_CAPABILITIES, surface: "web" },
} satisfies Record<AppSurface, AppSurfaceCapabilities>;

const AppSurfaceContext =
	createContext<AppSurfaceCapabilities>(DESKTOP_CAPABILITIES);

export function appSurfaceCapabilities(
	surface: AppSurface
): AppSurfaceCapabilities {
	return CAPABILITIES_BY_SURFACE[surface];
}

export function AppSurfaceProvider({
	children,
	surface,
}: {
	children?: ReactNode;
	surface: AppSurface;
}) {
	const capabilities = useMemo(
		() => appSurfaceCapabilities(surface),
		[surface]
	);

	return (
		<AppSurfaceContext.Provider value={capabilities}>
			{children}
		</AppSurfaceContext.Provider>
	);
}

export function useAppSurface(): AppSurfaceCapabilities {
	return useContext(AppSurfaceContext);
}

export function NativeDesktopOnly({ children }: { children?: ReactNode }) {
	return useAppSurface().isDesktop ? children : null;
}
