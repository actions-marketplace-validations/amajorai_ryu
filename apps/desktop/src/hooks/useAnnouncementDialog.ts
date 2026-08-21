import { useCallback, useEffect, useMemo, useState } from "react";
import type { Announcement } from "@/src/lib/api/announcements.ts";

interface UseAnnouncementDialogOptions {
	announcements: Announcement[];
	enabled?: boolean;
	loading: boolean;
	markRead: (id: string) => Promise<void>;
}

interface UseAnnouncementDialogResult {
	close: () => void;
	open: (announcement: Announcement) => void;
	selected: Announcement | null;
}

/**
 * Owns the detail dialog selection for every announcement surface. The first
 * loaded unread announcement is opened once automatically; after that, all
 * opens are explicit clicks so an older unread item never cascades over the
 * user's work when the newest one is marked read.
 */
export function useAnnouncementDialog({
	announcements,
	enabled = true,
	loading,
	markRead,
}: UseAnnouncementDialogOptions): UseAnnouncementDialogResult {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [autoOpened, setAutoOpened] = useState(false);

	const open = useCallback(
		(announcement: Announcement) => {
			setSelectedId(announcement.id);
			if (!announcement.read) {
				markRead(announcement.id).catch(() => undefined);
			}
		},
		[markRead]
	);

	useEffect(() => {
		if (!(enabled && !loading) || autoOpened) {
			return;
		}
		setAutoOpened(true);
		const latestUnread = announcements.find(
			(announcement) => !announcement.read
		);
		if (latestUnread) {
			open(latestUnread);
		}
	}, [announcements, autoOpened, enabled, loading, open]);

	const selected = useMemo(
		() =>
			announcements.find((announcement) => announcement.id === selectedId) ??
			null,
		[announcements, selectedId]
	);
	const close = useCallback(() => setSelectedId(null), []);

	return {
		close,
		open,
		selected,
	};
}
