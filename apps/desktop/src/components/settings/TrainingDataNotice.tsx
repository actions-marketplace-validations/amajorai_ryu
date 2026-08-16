import { Button } from "@ryu/ui/components/button.tsx";
import { ExternalLink } from "lucide-react";
import { FRONTEND_URL } from "@/lib/auth-client.ts";
import { openExternal } from "@/lib/tauri-bridge.ts";
import { SettingsCard, SettingsSection } from "./shared/settings-items.tsx";

const GITHUB_REPO = "https://github.com/amajorai/ryu";

/** A plain-language training commitment, intentionally presented beside settings. */
export function TrainingDataNotice() {
	const openGithub = () => {
		void Promise.resolve(openExternal(GITHUB_REPO)).catch(() => undefined);
	};

	const openLegal = (path: "/privacy" | "/terms") => {
		void Promise.resolve(openExternal(`${FRONTEND_URL}${path}`)).catch(
			() => undefined
		);
	};

	return (
		<SettingsSection title="Train on my data">
			<SettingsCard className="space-y-3">
				<div className="space-y-1">
					<p className="font-medium text-sm">We never train on your data.</p>
					<p className="text-muted-foreground text-xs leading-relaxed">
						Ryu never uses your chats, files, or activity to train Ryu models.
						Core and Gateway are open source, so you can inspect and verify that
						promise. You choose where work runs: on this computer, your
						self-hosted node, or a managed Ryu node. A model provider, app, or
						plugin you deliberately connect may process content to complete the
						task you ask for; its own terms and privacy policy apply.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<Button onClick={openGithub} size="sm" variant="ghost">
						<ExternalLink className="size-4" />
						GitHub
					</Button>
					<div className="flex gap-3 text-xs">
						<button
							className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
							onClick={() => openLegal("/privacy")}
							type="button"
						>
							Privacy
						</button>
						<button
							className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
							onClick={() => openLegal("/terms")}
							type="button"
						>
							Terms
						</button>
					</div>
				</div>
			</SettingsCard>
		</SettingsSection>
	);
}
