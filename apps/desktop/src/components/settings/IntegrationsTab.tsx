import { Button } from "@ryu/ui/components/button";
import { Input } from "@ryu/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select";
import { Switch } from "@ryu/ui/components/switch";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { sileo } from "sileo";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	fetchIngressBackend,
	INGRESS_URL_PREF,
	ingressLabel,
	setIngressBackend,
} from "@/src/lib/api/mesh.ts";
import {
	type AaStatsMode,
	getAaApiKey,
	getAaStatsMode,
	getHfToken,
	getPreference,
	setAaApiKey,
	setAaStatsMode,
	setHfToken,
	setPreference,
} from "@/src/lib/api/preferences.ts";
import { useGatewayDialog } from "@/src/store/useGatewayDialog.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import { useSettingsDialog } from "@/src/store/useSettingsDialog.ts";
import {
	type IngressToast,
	ingressErrorDescription,
	ingressSelectedToast,
	ingressUrlDirty,
	ingressUrlSavedToast,
	offersOwnRelay,
} from "./integrations-ingress.ts";
import {
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

// The ingress-kind label map + title-caser moved to `lib/api/mesh.ts`, next to
// the wire contract whose spelling they have to match (and where they can be
// unit-tested — this repo has no component-test harness). The webhook-ingress
// *decisions* (which control renders, which toast is true) moved to
// `./integrations-ingress.ts` for the same reason; read its header for why the
// public-URL input is gated on the OFFERED backends rather than the selected one.

/** Raise an {@link IngressToast} — the level→sileo mapping, in one place. */
function raiseIngressToast(toast: IngressToast): void {
	if (toast.level === "warning") {
		sileo.warning({ title: toast.title, description: toast.description });
		return;
	}
	sileo.success({ title: toast.title, description: toast.description });
}

export function IntegrationsTab() {
	const [hfToken, setHfTokenValue] = useState("");
	const [aaKey, setAaKeyValue] = useState("");
	const [aaMode, setAaModeValue] = useState<AaStatsMode>("cached");
	const [loaded, setLoaded] = useState(false);
	const [saving, setSaving] = useState(false);
	const [savingAa, setSavingAa] = useState(false);
	// Webhook ingress: the public-URL backend that receives Composio trigger
	// events. `null` = the running Core has no ingress plane (older binary), so
	// the section is hidden entirely.
	const [ingressBackend, setIngressBackendValue] = useState("");
	const [ingressChoices, setIngressChoices] = useState<string[] | null>(null);
	const [ingressDefault, setIngressDefault] = useState("");
	const [savingIngress, setSavingIngress] = useState(false);
	// The BYO public base URL the `own-relay` backend needs (`webhook.ingress.url`
	// pref). Until this input existed the pref had no writer anywhere in the tree,
	// so picking "Self-hosted relay" saved a backend that could never resolve a
	// URL — `start()`/`public_url()` bail on an empty base and inbound webhooks
	// (Composio triggers, workflow webhooks) stop arriving after the next restart.
	const [ingressUrl, setIngressUrlValue] = useState("");
	// The value currently PERSISTED in the pref, tracked separately from what is
	// typed. Core's selection gate reads the pref, not this input, so "typed but
	// not saved" is a real state a user can be in and be refused for; the dirty
	// marker below is what makes that visible instead of surprising.
	const [savedIngressUrl, setSavedIngressUrl] = useState("");
	const [ingressUrlLoaded, setIngressUrlLoaded] = useState(false);
	const [savingIngressUrl, setSavingIngressUrl] = useState(false);

	const navigate = useNavigate();
	const openGateway = useGatewayDialog((s) => s.openGateway);
	const closeSettings = useSettingsDialog((s) => s.setOpen);
	// This tab now lives in the Gateway dialog, but may still be reachable from
	// Settings; close whichever large modal is hosting it before leaving to a page.
	const closeGateway = useGatewayDialog((s) => s.setOpen);

	useEffect(() => {
		let cancelled = false;
		const target = toTarget(useNodeStore.getState().getActiveNode());
		Promise.all([
			getHfToken(target),
			getAaApiKey(target),
			getAaStatsMode(target),
		]).then(([token, key, mode]) => {
			if (!cancelled) {
				setHfTokenValue(token);
				setAaKeyValue(key);
				setAaModeValue(mode);
				setLoaded(true);
			}
		});
		// Ingress backend is a soft dependency — an older Core 404s here, which
		// we swallow and leave `ingressChoices` null so the section stays hidden.
		fetchIngressBackend(target)
			.then((cfg) => {
				if (!cancelled) {
					setIngressBackendValue(cfg.backend);
					setIngressChoices(cfg.available);
					setIngressDefault(cfg.default);
				}
			})
			.catch(() => {
				// No ingress plane on this node — leave the section hidden.
			});
		getPreference(target, INGRESS_URL_PREF).then((val) => {
			if (!cancelled) {
				setIngressUrlValue(val ?? "");
				setSavedIngressUrl(val ?? "");
				setIngressUrlLoaded(true);
			}
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const handleSelectIngress = async (kind: string | null) => {
		if (!kind || kind === ingressBackend) {
			return;
		}
		const previous = ingressBackend;
		setIngressBackendValue(kind);
		setSavingIngress(true);
		const target = toTarget(useNodeStore.getState().getActiveNode());
		try {
			await setIngressBackend(target, kind);
			// Reaching here means Core's own-relay gate PASSED, so the "no public URL
			// saved" warning that used to live here can no longer be true in its
			// primary case — see `ingressSelectedToast` for what replaced it and why
			// the saved value (not the typed one) is what the branch reads.
			raiseIngressToast(
				ingressSelectedToast(kind, ingressUrlLoaded, savedIngressUrl)
			);
		} catch (e) {
			setIngressBackendValue(previous);
			// Core's refusals carry the fix in the body (`{"error": …}`): the 400
			// names the pref + env var to set, the 409 names the variable to unset.
			// `Error.message` is only "…/backend failed: 400", which is a wall.
			sileo.error({
				title: "Failed to set ingress backend",
				description: ingressErrorDescription(e),
			});
		} finally {
			setSavingIngress(false);
		}
	};

	// Save the BYO public base URL. Core reads `webhook.ingress.url` raw
	// (`prefs.get(key)` → `Option<String>` handed to `from_prefs`), exactly like
	// `mesh-login-server`, so the bare string is written — no JSON wrapping. The
	// ingress is built once at Core start, so this applies on the next restart.
	const handleSaveIngressUrl = async () => {
		setSavingIngressUrl(true);
		const target = toTarget(useNodeStore.getState().getActiveNode());
		const trimmed = ingressUrl.trim();
		const ok = await setPreference(target, INGRESS_URL_PREF, trimmed);
		setSavingIngressUrl(false);
		if (!ok) {
			sileo.error({ title: "Failed to save the public URL" });
			return;
		}
		// Core stored the trimmed form, so that — not the raw input — is now the
		// persisted value the selection gate will read.
		setIngressUrlValue(trimmed);
		setSavedIngressUrl(trimmed);
		// No client-side URL validation on purpose: `own_relay_rejection` in Core is
		// the single authority on what counts as usable, and a second copy here would
		// drift from it. The cost is bounded but real, and not claimed away: while
		// own-relay is NOT the active backend the pref is inert and Core refuses the
		// eventual selection with the reason; while it IS active nothing re-validates
		// a write (the gate runs only on the backend POST), so a bad value saved here
		// surfaces at the next Core start. Closing that belongs in Core, on the pref
		// write — not in a second copy of the rule.
		raiseIngressToast(ingressUrlSavedToast(trimmed, ingressBackend));
	};

	const handleToggleRealtime = async (live: boolean) => {
		const next: AaStatsMode = live ? "realtime" : "cached";
		setAaModeValue(next);
		const target = toTarget(useNodeStore.getState().getActiveNode());
		const ok = await setAaStatsMode(target, next);
		if (ok) {
			sileo.success({
				title: live
					? "Using live Artificial Analysis data"
					: "Using cached data",
			});
		} else {
			setAaModeValue(live ? "cached" : "realtime");
			sileo.error({ title: "Failed to update data mode" });
		}
	};

	const handleSave = async () => {
		setSaving(true);
		const target = toTarget(useNodeStore.getState().getActiveNode());
		const ok = await setHfToken(target, hfToken);
		setSaving(false);
		if (ok) {
			sileo.success({ title: "Hugging Face token saved" });
		} else {
			sileo.error({ title: "Failed to save Hugging Face token" });
		}
	};

	const handleSaveAa = async () => {
		setSavingAa(true);
		const target = toTarget(useNodeStore.getState().getActiveNode());
		const ok = await setAaApiKey(target, aaKey);
		setSavingAa(false);
		if (ok) {
			sileo.success({ title: "Artificial Analysis key saved" });
		} else {
			sileo.error({ title: "Failed to save Artificial Analysis key" });
		}
	};

	// Close this dialog before opening the Gateway dialog — both are large
	// modals, so stacking them would trap focus in two places at once.
	const handleOpenGatewayKeys = () => {
		closeSettings(false);
		openGateway("keys");
	};

	const handleOpenMarketplace = () => {
		closeSettings(false);
		closeGateway(false);
		navigate("/marketplace");
	};

	// Both derived in `./integrations-ingress.ts` so they are unit-testable:
	// whether Save has anything to write (see `ingressUrlDirty` for why the typed
	// value is never auto-persisted), and whether the URL input is offered at all
	// — keyed to the backends Core OFFERS (`available`), not the one selected.
	const urlDirty = ingressUrlDirty(ingressUrl, savedIngressUrl);
	const showIngressUrl = offersOwnRelay(ingressChoices);

	return (
		<div className="space-y-6">
			<SettingsSection
				caption="Add a Hugging Face access token to raise download rate limits and install gated models (the ones marked with a lock in the model catalog)."
				title="Hugging Face"
			>
				<SettingsGroup>
					<SettingsItem title="Access token">
						<div className="flex items-center gap-2">
							<Input
								autoComplete="off"
								className="h-8 flex-1 text-xs"
								disabled={!loaded}
								id="hf-token"
								onChange={(e) => setHfTokenValue(e.target.value)}
								placeholder="hf_…"
								type="password"
								value={hfToken}
							/>
							<Button
								disabled={!loaded || saving}
								onClick={handleSave}
								size="sm"
							>
								{saving ? "Saving…" : "Save"}
							</Button>
						</div>
						<p className="text-muted-foreground text-xs">
							Stored locally on this device and sent only to huggingface.co.
							Leave empty and save to remove it.
						</p>
					</SettingsItem>
				</SettingsGroup>

				<div className="mx-3 space-y-1.5 rounded-lg border border-dashed px-4 py-3 text-muted-foreground text-xs">
					<p className="font-medium text-foreground">How to set this up</p>
					<ol className="list-decimal space-y-1 pl-4">
						<li>
							Create a token at{" "}
							<a
								className="underline hover:text-foreground"
								href="https://huggingface.co/settings/tokens"
								rel="noopener noreferrer"
								target="_blank"
							>
								huggingface.co/settings/tokens
							</a>
							. A <code>read</code> token is enough.
						</li>
						<li>Paste it above and click Save.</li>
						<li>
							For each gated model, open its Hugging Face page and accept the
							model's terms first. A token alone does not unlock a gated
							download.
						</li>
					</ol>
				</div>
			</SettingsSection>

			<SettingsSection
				caption="Add an Artificial Analysis API key to enrich the model catalog with independent benchmark stats: intelligence index, output speed, latency, and price. The catalog works fine without one."
				title="Artificial Analysis"
			>
				<SettingsGroup>
					<SettingsItem title="API key">
						<div className="flex items-center gap-2">
							<Input
								autoComplete="off"
								className="h-8 flex-1 text-xs"
								disabled={!loaded}
								id="aa-key"
								onChange={(e) => setAaKeyValue(e.target.value)}
								placeholder="aa-…"
								type="password"
								value={aaKey}
							/>
							<Button
								disabled={!loaded || savingAa}
								onClick={handleSaveAa}
								size="sm"
							>
								{savingAa ? "Saving…" : "Save"}
							</Button>
						</div>
						<p className="text-muted-foreground text-xs">
							Stored locally on this device and sent only to
							artificialanalysis.ai. Leave empty and save to remove it.
						</p>
					</SettingsItem>
					<SettingsItem
						actions={
							<Switch
								checked={aaMode === "realtime"}
								disabled={!loaded}
								id="aa-realtime"
								onCheckedChange={handleToggleRealtime}
							/>
						}
						description="Off (default): cache the stats on this device and refresh once a day, which is kinder to the API's daily rate limit. On: fetch live every time."
						title="Live data"
					/>
				</SettingsGroup>

				<div className="mx-3 space-y-1.5 rounded-lg border border-dashed px-4 py-3 text-muted-foreground text-xs">
					<p className="font-medium text-foreground">How to set this up</p>
					<ol className="list-decimal space-y-1 pl-4">
						<li>
							Create a free key at{" "}
							<a
								className="underline hover:text-foreground"
								href="https://artificialanalysis.ai/api-reference"
								rel="noopener noreferrer"
								target="_blank"
							>
								artificialanalysis.ai/api-reference
							</a>
							.
						</li>
						<li>Paste it above and click Save.</li>
						<li>
							Stats appear on model detail pages in the catalog when a model
							matches an Artificial Analysis entry.
						</li>
					</ol>
				</div>
			</SettingsSection>

			<SettingsSection
				caption="Composio powers agent connections (Gmail, GitHub, Slack, and 800+ apps). Its API key now lives with the other execution credentials in Gateway → API keys; browse and connect accounts in Marketplace → Connections."
				title="Composio"
			>
				<div className="mx-3 space-y-1.5 rounded-lg border border-dashed px-4 py-3 text-muted-foreground text-xs">
					<p className="font-medium text-foreground">
						Moved to Gateway → API keys
					</p>
					<ol className="list-decimal space-y-1 pl-4">
						<li>
							Open this device's settings → API keys and paste your Composio API
							key (create one at{" "}
							<a
								className="underline hover:text-foreground"
								href="https://platform.composio.dev"
								rel="noopener noreferrer"
								target="_blank"
							>
								platform.composio.dev
							</a>
							).
						</li>
						<li>
							Go to Marketplace → Connections to connect the apps you want
							(Gmail, GitHub, …).
						</li>
						<li>
							Open an agent in the editor → Connections to attach connected
							toolkits, choosing all tools or specific ones.
						</li>
					</ol>
					<div className="flex flex-wrap gap-2 pt-1">
						<Button onClick={handleOpenGatewayKeys} size="sm" variant="ghost">
							Open Gateway keys
						</Button>
						<Button onClick={handleOpenMarketplace} size="sm" variant="ghost">
							Open Marketplace
						</Button>
					</div>
				</div>
			</SettingsSection>

			{ingressChoices && ingressChoices.length > 0 && (
				<SettingsSection
					caption="Choose how this node exposes a public URL to receive inbound webhooks (the Composio triggers above need one). The backend is built when the node starts, so a change applies after a restart."
					title="Webhook ingress"
				>
					<SettingsGroup>
						<SettingsItem
							actions={
								<Select
									disabled={savingIngress}
									items={ingressChoices.map((kind) => ({
										label: ingressLabel(kind),
										value: kind,
									}))}
									onValueChange={handleSelectIngress}
									value={ingressBackend}
								>
									<SelectTrigger className="h-8 w-56 text-xs">
										<SelectValue placeholder="Select a backend" />
									</SelectTrigger>
									<SelectContent>
										{ingressChoices.map((kind) => (
											<SelectItem key={kind} value={kind}>
												{ingressLabel(kind)}
												{kind === ingressDefault ? " (default)" : ""}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							}
							description="Applies on the next node restart. Ryu Relay is the managed default; Tailscale Funnel and Cloudflare Tunnel expose this node's own URL."
							title="Ingress backend"
						/>
						{/*
						 * The self-hosted relay is the one backend that cannot discover a
						 * URL for itself: Core deliberately refuses to fall back to the
						 * loopback bind address (it would report a green ingress on an
						 * address no sender can reach), so with no base the ingress errors
						 * and stays down. This input is the only writer of the
						 * `webhook.ingress.url` pref — the other supplier is the
						 * `RYU_WEBHOOK_INGRESS_URL` env var, which the client cannot see.
						 *
						 * It renders whenever the picker OFFERS the self-hosted relay, not
						 * when it is selected. Gating on the selection made this a control
						 * you could only reach from a state Core now refuses to enter (it
						 * 400s an own-relay selection with no usable URL), i.e. the pref's
						 * sole writer sat behind its own precondition. The title and the
						 * copy scope it to that one backend so it reads as "configure this
						 * to enable Self-hosted relay" while another backend is active,
						 * rather than as a URL the current backend uses.
						 */}
						{showIngressUrl && (
							<SettingsItem title="Self-hosted relay public URL">
								<div className="flex items-center gap-2">
									<Input
										autoComplete="off"
										className="h-8 flex-1 text-xs"
										disabled={!ingressUrlLoaded}
										id="ingress-url"
										onChange={(e) => setIngressUrlValue(e.target.value)}
										placeholder="https://ryu.example.com"
										type="url"
										value={ingressUrl}
									/>
									<Button
										disabled={
											!ingressUrlLoaded || savingIngressUrl || !urlDirty
										}
										onClick={handleSaveIngressUrl}
										size="sm"
									>
										{savingIngressUrl ? "Saving…" : "Save"}
									</Button>
								</div>
								{urlDirty && ingressUrlLoaded ? (
									<p className="font-medium text-foreground text-xs">
										Not saved yet. Selecting Self-hosted relay checks the saved
										value, not what is typed here.
									</p>
								) : null}
								<p className="text-muted-foreground text-xs">
									Save this first, then pick <em>Self-hosted relay</em> above:
									that backend serves whatever base is configured and this node
									refuses the selection until one is. Use the address this node
									is reachable at from the public internet: scheme and host, no
									path (your reverse proxy or tunnel); webhook paths are
									appended to it. The other backends publish a URL of their own
									and ignore this. Set <code>RYU_WEBHOOK_INGRESS_URL</code> in
									this node's environment instead if you prefer. It takes
									precedence over this field, and pins the backend to
									Self-hosted relay.
								</p>
							</SettingsItem>
						)}
					</SettingsGroup>
				</SettingsSection>
			)}
		</div>
	);
}
