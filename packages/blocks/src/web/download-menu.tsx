"use client";

import { Button } from "@ryu/ui/components/button";
import {
	ButtonGroup,
	ButtonGroupSeparator,
} from "@ryu/ui/components/button-group";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@ryu/ui/components/dropdown-menu";
import { cn } from "@ryu/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import {
	archLabel,
	type DownloadArch,
	type DownloadOS,
	detectDownloadArch,
	detectDownloadOS,
	loadReleases,
	osName,
	RELEASES_PAGE,
	type Release,
	resolveDownloadState,
	stableReleases,
} from "./download-assets.ts";
import { DownloadDropdownContent } from "./download-dropdown-content.tsx";
import { OS_SVGL, SvglIcon } from "./svgl-icon.tsx";

export function DownloadMenu({
	className,
	contentAlign = "start",
	label = "Download",
	showChevron = true,
	showPlatform = false,
	separatorClassName,
	size = "default",
	variant = "default",
}: {
	className?: string;
	contentAlign?: "center" | "end" | "start";
	label?: string;
	showChevron?: boolean;
	/** Use the longer OS-aware label reserved for the dedicated download page. */
	showPlatform?: boolean;
	separatorClassName?: string;
	size?: "default" | "lg" | "sm";
	variant?: "default" | "ghost" | "outline";
}) {
	const [os, setOs] = useState<DownloadOS>("macos");
	const [arch, setArch] = useState<DownloadArch>("intel");
	const [releases, setReleases] = useState<Release[]>([]);

	useEffect(() => {
		setOs(detectDownloadOS());
		setArch(detectDownloadArch());

		let active = true;
		loadReleases()
			.then((data) => {
				if (active) {
					setReleases(stableReleases(data).slice(0, 8));
				}
			})
			.catch(() => {
				// The main action falls back to the releases page when GitHub is unavailable.
			});
		return () => {
			active = false;
		};
	}, []);

	const state = resolveDownloadState(releases, os, arch);
	const ready = state.kind === "ready";
	const href = ready ? state.asset.browser_download_url : RELEASES_PAGE;
	const primaryLabel = showPlatform
		? `Download for ${osName(os)} (${archLabel(os, arch)})`
		: label;
	const iconSize = size === "lg" ? 18 : 16;
	const triggerClassName =
		size === "lg"
			? "h-14 w-12 px-0"
			: size === "sm"
				? "h-8 w-8 px-0"
				: "h-9 w-9 px-0";

	return (
		<ButtonGroup>
			<Button
				className={cn("gap-1.5", className)}
				nativeButton={false}
				render={
					<a
						download={ready ? state.asset.name : undefined}
						href={href}
						rel="noopener noreferrer"
						{...(ready ? {} : { target: "_blank" })}
					/>
				}
				size={size}
				variant={variant}
			>
				{showPlatform ? (
					<SvglIcon
						className="brightness-0 invert"
						size={iconSize}
						spec={OS_SVGL[os]}
					/>
				) : null}
				{primaryLabel}
			</Button>
			<ButtonGroupSeparator className={separatorClassName} />
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label="More download options"
							className={triggerClassName}
							size={size}
							variant={variant}
						>
							{showChevron ? <ChevronDown className="size-4" /> : null}
						</Button>
					}
				/>
				<DownloadDropdownContent align={contentAlign} />
			</DropdownMenu>
		</ButtonGroup>
	);
}

// biome-ignore lint/performance/noBarrelFile: re-export for consumers that import from download-menu
export { DownloadDropdownContent } from "./download-dropdown-content.tsx";
