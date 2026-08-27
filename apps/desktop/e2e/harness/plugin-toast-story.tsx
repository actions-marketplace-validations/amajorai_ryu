import { Toaster, toast } from "@ryu/ui/components/sileo.tsx";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	createScopedToastHost,
	createSileoToastRenderer,
} from "../../../../packages/app-host/src/toast-host.ts";
import "../../src/index.css";

function Story() {
	const host = useMemo(
		() =>
			createScopedToastHost({
				renderer: createSileoToastRenderer(toast),
				sourceId: "@ryu/plugin-toast-story",
			}),
		[]
	);
	const [toastId, setToastId] = useState<string | null>(null);

	return (
		<div className="min-h-screen bg-background p-10 text-foreground">
			<div className="mx-auto flex max-w-xl flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm">
				<div>
					<p className="text-muted-foreground text-xs uppercase tracking-widest">
						Sandboxed app host
					</p>
					<h1 className="font-semibold text-2xl">Plugin toast bridge</h1>
					<p className="mt-2 text-muted-foreground text-sm">
						The buttons call the same bounded host lane used by app and plugin
						frames.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<button
						className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-sm"
						data-testid="show-plugin-toast"
						onClick={() => {
							setToastId(
								host.show({
									description:
										"The host owns rendering and caller-scoped cleanup.",
									duration: 60_000,
									title: "Plugin connected",
									variant: "loading",
								})
							);
						}}
						type="button"
					>
						Show app toast
					</button>
					<button
						className="rounded-md border px-3 py-2 font-medium text-sm"
						data-testid="update-plugin-toast"
						disabled={!toastId}
						onClick={() => {
							if (toastId) {
								host.update({
									description:
										"The caller-local id updated the same Sileo slot.",
									id: toastId,
									title: "Plugin finished",
									variant: "success",
								});
							}
						}}
						type="button"
					>
						Update
					</button>
					<button
						className="rounded-md border px-3 py-2 font-medium text-sm"
						data-testid="dismiss-plugin-toast"
						disabled={!toastId}
						onClick={() => {
							if (toastId) {
								host.dismiss({ id: toastId });
								setToastId(null);
							}
						}}
						type="button"
					>
						Dismiss
					</button>
				</div>
				<output className="text-muted-foreground text-xs">
					{toastId ? "Caller id is active" : "No active caller id"}
				</output>
			</div>
			<Toaster position="bottom-right" />
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
