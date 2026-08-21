/** Options that keep the Electron updater out of the Windows installer wizard. */
export const ELECTRON_UPDATE_INSTALL_OPTIONS = {
	isForceRunAfter: true,
	isSilent: true,
} as const;

/**
 * Automatic updates may install only after the packaged app has downloaded one
 * and the shared preference still allows unattended updates.
 */
export function shouldAutoInstallDownloadedUpdate(
	isPackaged: boolean,
	autoUpdatesEnabled: boolean
): boolean {
	return isPackaged && autoUpdatesEnabled;
}
