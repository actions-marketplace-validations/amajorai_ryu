"use client";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@ryu/ui/components/dialog.tsx";
import { useCallback, useMemo, useState } from "react";
import { PluginHostPanel } from "@/src/contributions/host/PluginHostPanel.tsx";
import type { PluginCompanion } from "@/src/lib/api/plugins.ts";

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const MAX_SKETCH_DATA_URL_LENGTH = 16_000_000;

export interface DrawesomeSketchAttachment {
	dataUrl: string;
	filename: string;
	mimeType: "image/png";
	size: number;
}

interface DrawesomeSketchDialogProps {
	companion: PluginCompanion | undefined;
	onAttach: (attachment: DrawesomeSketchAttachment) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	sourceImage?: {
		filename: string;
		url: string;
	};
}

function createMessageToken(): string {
	if (typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `drawesome-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseAttachment(value: unknown): DrawesomeSketchAttachment | null {
	if (!isRecord(value)) {
		return null;
	}
	const dataUrl = value.dataUrl;
	if (
		typeof dataUrl !== "string" ||
		dataUrl.length > MAX_SKETCH_DATA_URL_LENGTH ||
		!dataUrl.startsWith(PNG_DATA_URL_PREFIX) ||
		!/^[A-Za-z0-9+/=]+$/.test(dataUrl.slice(PNG_DATA_URL_PREFIX.length))
	) {
		return null;
	}
	const filename =
		typeof value.filename === "string" &&
		/^[a-zA-Z0-9._-]{1,80}$/.test(value.filename)
			? value.filename
			: "sketch.png";
	const size =
		typeof value.size === "number" &&
		Number.isSafeInteger(value.size) &&
		value.size > 0
			? value.size
			: Math.floor((dataUrl.length - PNG_DATA_URL_PREFIX.length) * 0.75);
	return { dataUrl, filename, mimeType: "image/png", size };
}

export function DrawesomeSketchDialog({
	companion,
	onAttach,
	onOpenChange,
	open,
	sourceImage,
}: DrawesomeSketchDialogProps) {
	const [messageToken] = useState(createMessageToken);
	const mountContext = useMemo(
		() => ({ mode: "sketch-dialog", token: messageToken, image: sourceImage }),
		[messageToken, sourceImage]
	);

	const handleFrameMessage = useCallback(
		(data: unknown) => {
			if (!isRecord(data)) {
				return;
			}
			if (data.kind !== "ryu-drawesome-dialog" || data.token !== messageToken) {
				return;
			}
			if (data.action === "close") {
				onOpenChange(false);
				return;
			}
			if (data.action !== "attach") {
				return;
			}
			const attachment = parseAttachment(data.file);
			if (!attachment) {
				return;
			}
			onAttach(attachment);
			onOpenChange(false);
		},
		[messageToken, onAttach, onOpenChange]
	);

	if (!companion) {
		return null;
	}

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent
				className="h-[min(760px,calc(100dvh-2rem))] max-w-[min(860px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
				mobileFullPage
			>
				<DialogTitle className="sr-only">Sketch</DialogTitle>
				<DialogDescription className="sr-only">
					Draw a visual reference and attach it to your next message.
				</DialogDescription>
				<div className="min-h-0 flex-1">
					<PluginHostPanel
						companion={companion}
						mountContext={mountContext}
						onMessage={handleFrameMessage}
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
