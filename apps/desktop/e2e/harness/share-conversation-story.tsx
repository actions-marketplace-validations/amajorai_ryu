import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ShareConversationDialog } from "../../src/components/chat/ShareConversationDialog.tsx";
import "../../src/index.css";

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});

const readOnlyStory = new URLSearchParams(globalThis.location.search).has(
	"readonly"
);

function record(value: string) {
	const output = document.getElementById("share-result");
	if (output) {
		output.textContent = value;
	}
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = typeof input === "string" ? input : input.toString();
	if (url.endsWith("/api/auth/token")) {
		return json({}, 401);
	}
	if (url.endsWith("/api/conversations/conversation-1/access")) {
		if (init?.method === "PUT") {
			record(`saved:${String(init.body)}`);
			return json({ ok: true });
		}
		return json({
			can_manage: !readOnlyStory,
			collaborators: [
				{
					role: "viewer",
					user_id: readOnlyStory ? "user-owner" : "user-noor",
				},
			],
			owner_user_id: readOnlyStory ? "user-mira" : "user-owner",
			team_id: null,
			visibility: "private",
		});
	}
	if (url.endsWith("/api/acl/principals")) {
		return json({
			members: [
				{ email: "jiawei@example.com", id: "user-owner", name: "Jia Wei Ng" },
				{ email: "noor@example.com", id: "user-noor", name: "Noor Aziz" },
				{ email: "mira@example.com", id: "user-mira", name: "Mira Chen" },
			],
			org_id: "org-ryu",
			teams: [
				{ id: "team-product", name: "Product" },
				{ id: "team-research", name: "Research" },
			],
		});
	}
	if (url.endsWith("/api/conversations/conversation-1")) {
		return json({
			messages: [
				{
					content: "Can we share this rollout plan?",
					created_at: 1_724_000_000_000,
					id: "message-1",
					role: "user",
				},
				{
					content:
						"Yes — I’ve separated the public milestones from the internal notes.",
					created_at: 1_724_000_010_000,
					id: "message-2",
					role: "assistant",
				},
			],
		});
	}
	if (url.includes("/api/conversation-shares/conversation/conversation-1")) {
		if (init?.method === "PUT") {
			record("published");
		}
		if (init?.method === "DELETE") {
			record("revoked");
			return json({ ok: true });
		}
		return json({
			share: {
				created_at: 1_724_000_020_000,
				updated_at: 1_724_000_030_000,
				url: "https://ryu.test/share/story-token",
			},
		});
	}
	return json({ error: `Unhandled story request: ${url}` }, 404);
}) as typeof fetch;

function Story() {
	const [open, setOpen] = useState(true);
	return (
		<div className="min-h-screen bg-muted/40 p-8">
			<div className="mx-auto max-w-3xl rounded-2xl border bg-background p-8 shadow-sm">
				<p className="text-muted-foreground text-xs">Ryu · Release planning</p>
				<h1 className="mt-2 font-semibold text-xl">
					Launch readiness and rollout plan
				</h1>
				<div className="mt-8 space-y-4 opacity-45">
					<div className="ml-auto h-16 w-2/3 rounded-2xl bg-muted" />
					<div className="h-28 w-4/5 rounded-2xl border" />
				</div>
			</div>
			<pre className="sr-only" data-testid="share-result" id="share-result" />
			<ShareConversationDialog
				conversationId="conversation-1"
				onOpenChange={setOpen}
				open={open}
				target={{ token: "node-token", url: "http://core.test" }}
				title="Launch readiness and rollout plan"
			/>
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
