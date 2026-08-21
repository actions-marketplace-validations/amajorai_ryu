import { Megaphone01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DEFAULT_ANNOUNCEMENT_VISUAL_CODE } from "@ryu/ui/components/announcement-visual.tsx";
import { NotificationStack } from "@ryu/ui/components/notification-stack";
import { useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import "../../src/index.css";
import { AnnouncementDetailDialog } from "../../src/components/notifications/announcement-detail-dialog.tsx";
import { buildAnnouncementStackItems } from "../../src/components/notifications/announcement-stack-items.tsx";
import { useAnnouncementDialog } from "../../src/hooks/useAnnouncementDialog.ts";
import type { Announcement } from "../../src/lib/api/announcements.ts";

const NEWEST: Announcement = {
	blobColors: ["#07111f", "#164e63", "#7c3aed"],
	body: "The scene and image are both authored on this announcement, then revealed together in its detail dialog.",
	color: "#67e8f9",
	createdAt: "2026-08-18T08:00:00.000Z",
	icon: "megaphone",
	iconUrl: "http://127.0.0.1:5177/announcement-visual-art.svg",
	id: "announcement-visual-newest",
	linkLabel: "Read the release",
	linkUrl: "https://ryu.example.test/releases/visuals",
	read: false,
	title: "Visual announcements are here",
	type: "card",
	visualCode: DEFAULT_ANNOUNCEMENT_VISUAL_CODE,
	visualIconBackground: null,
	visualIconDither: { direction: "down", from: 196, to: "transparent" },
	visualIcon: "lucide:sparkles",
	visualIconUrl: null,
};

const OLDER: Announcement = {
	blobColors: ["#1c102e", "#5b21b6", "#be185d"],
	body: "A second announcement carries a different scene definition and palette, proving visuals belong to the record.",
	color: "#f9a8d4",
	createdAt: "2026-08-16T08:00:00.000Z",
	icon: "sparkles",
	iconUrl: null,
	id: "announcement-visual-older",
	linkLabel: null,
	linkUrl: null,
	read: false,
	title: "The orbit palette is separate",
	type: "card",
	visualCode: JSON.stringify({
		layers: [
			{ type: "beam", angle: 24, color: "#f9a8d4", duration: 6 },
			{ type: "bars", count: 11, color: "#fef3c7", duration: 3.5 },
		],
		version: 1,
	}),
	visualIconBackground: "#30105c",
	visualIconDither: null,
	visualIcon: null,
	visualIconUrl: "http://127.0.0.1:5177/announcement-custom-icon.svg",
};

function AnnouncementVisualsProof() {
	const [announcements, setAnnouncements] = useState<Announcement[]>([
		NEWEST,
		OLDER,
	]);
	const dialog = useAnnouncementDialog({
		announcements,
		loading: false,
		markRead: async (id) => {
			setAnnouncements((current) =>
				current.map((announcement) =>
					announcement.id === id
						? { ...announcement, read: true }
						: announcement
				)
			);
		},
	});
	const items = useMemo(
		() =>
			buildAnnouncementStackItems({
				announcements,
				dismiss: (id) =>
					setAnnouncements((current) =>
						current.filter((announcement) => announcement.id !== id)
					),
				onOpenAnnouncement: dialog.open,
				onOpenSystem: () => undefined,
				systemAnnouncements: [],
			}),
		[announcements, dialog.open]
	);

	return (
		<main
			className="min-h-screen bg-[#08090d] px-6 py-8 text-zinc-100"
			data-testid="announcement-visuals-proof"
		>
			<div className="mx-auto flex max-w-5xl flex-col gap-6">
				<header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<p className="font-medium text-[11px] text-cyan-300 uppercase tracking-[0.2em]">
							Ryu desktop verification
						</p>
						<h1 className="mt-2 font-semibold text-3xl tracking-tight">
							Announcement visual detail
						</h1>
						<p className="mt-2 max-w-2xl text-sm text-zinc-400 leading-6">
							Each banner owns its own admin-authored React scene, image, icon,
							and warp palette. The compact banner stays quiet until its detail
							is opened.
						</p>
					</div>
					<div
						className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 font-medium text-emerald-300 text-xs"
						data-testid="proof-status"
					>
						{dialog.selected?.title ?? "Detail closed"}
					</div>
				</header>

				<section className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
					<aside
						className="rounded-3xl border border-white/10 bg-white/[0.035] p-4"
						data-testid="announcement-banner-surface"
					>
						<div className="mb-3 flex items-center justify-between">
							<span className="font-medium text-sm">Announcement banners</span>
							<span className="text-[10px] text-zinc-500">no artwork here</span>
						</div>
						<NotificationStack
							className="max-w-none"
							defaultExpanded
							expandedLabel="Announcements"
							items={items}
							maxVisible={3}
						/>
					</aside>

					<div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.02] p-5">
						<div className="grid gap-3 sm:grid-cols-3">
							<div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3">
								<p className="font-medium text-xs">Latest unread</p>
								<p className="mt-1 text-[11px] text-zinc-400">
									Auto-opened on load
								</p>
							</div>
							<div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
								<p className="font-medium text-xs">Image</p>
								<p className="mt-1 text-[11px] text-zinc-400">
									Dialog-only mount
								</p>
							</div>
							<div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
								<p className="font-medium text-xs">Warp palette</p>
								<p className="mt-1 text-[11px] text-zinc-400">
									Admin-controlled stops
								</p>
							</div>
						</div>
						<div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-zinc-400">
							<div className="flex items-center gap-2 text-zinc-200">
								<HugeiconsIcon
									className="size-4 text-cyan-300"
									icon={Megaphone01Icon}
								/>
								<p className="font-medium">React visual scene source</p>
							</div>
							<pre
								className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-5"
								data-testid="visual-code-source"
							>
								{NEWEST.visualCode}
							</pre>
						</div>
					</div>
				</section>
			</div>
			<AnnouncementDetailDialog
				announcement={dialog.selected}
				onOpenChange={(open) => {
					if (!open) {
						dialog.close();
					}
				}}
				onOpenLink={() => undefined}
				open={Boolean(dialog.selected)}
			/>
		</main>
	);
}

const proofWindow = window as Window & {
	__announcementVisualsProofRoot?: Root;
};
let proofRoot = proofWindow.__announcementVisualsProofRoot;
if (!proofRoot) {
	proofRoot = createRoot(document.getElementById("root")!);
	proofWindow.__announcementVisualsProofRoot = proofRoot;
}
proofRoot.render(<AnnouncementVisualsProof />);
