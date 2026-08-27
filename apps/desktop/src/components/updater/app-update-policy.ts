import type {
	AppUpdateSource,
	PreparedAppUpdate,
} from "@/src/lib/app-update-preparation.ts";
import type { ReleaseChannel } from "@/src/lib/release-channel.ts";

export const APP_UPDATE_DOWNLOAD_TITLE = "Download updates automatically";
export const APP_UPDATE_DOWNLOAD_DESCRIPTION =
	"Download updates in the background. Ryu asks before installing and restarting.";
export const APP_UPDATE_DOWNLOAD_ARIA_LABEL =
	"Download app updates automatically";
export const APP_UPDATE_INSTALL_ACTION = "Install and restart";

export type PreparedUpdateAction =
	| { kind: "clear_and_notify" }
	| { kind: "notify_download" }
	| { kind: "prepare" }
	| { kind: "prompt_install" }
	| { kind: "replace" };

export function choosePreparedUpdateAction(input: {
	automaticDownload: boolean;
	latest: string;
	preparedVersion: PreparedAppUpdate["version"] | null;
}): PreparedUpdateAction {
	if (input.preparedVersion === input.latest) {
		return { kind: "prompt_install" };
	}
	if (input.preparedVersion) {
		return input.automaticDownload
			? { kind: "replace" }
			: { kind: "clear_and_notify" };
	}
	return input.automaticDownload
		? { kind: "prepare" }
		: { kind: "notify_download" };
}

export type AppUpdatePinPolicy =
	| { kind: "none" }
	| { allowed: boolean; kind: "required"; tag: string };

export function resolveAppUpdateSource(input: {
	channel: ReleaseChannel;
	pin: AppUpdatePinPolicy;
}): AppUpdateSource | null {
	if (input.pin.kind === "required") {
		if (
			!(input.pin.allowed && input.pin.tag) ||
			(input.channel !== "stable" && input.channel !== "beta")
		) {
			return null;
		}
		return {
			channel: input.channel,
			kind: "tag",
			tag: input.pin.tag,
		};
	}

	if (input.channel === "stable") {
		return { kind: "stable" };
	}
	return { channel: input.channel, kind: "channel" };
}
