import { Button } from "@ryu/ui/components/button.tsx";
import { Input } from "@ryu/ui/components/input.tsx";
import { Textarea } from "@ryu/ui/components/textarea.tsx";
import { useEffect, useState } from "react";
import { sileo } from "sileo";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	getNodeRoutingPreferences,
	type NodeRoutingPreferences,
	parseNodeRoutingPreferences,
	setNodeRoutingPreferences,
} from "@/src/lib/api/preferences.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import {
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

const EMPTY_PATTERNS = "";

function patternsText(prefs: NodeRoutingPreferences): string {
	const patterns = prefs.firewall?.custom_patterns ?? [];
	return patterns.length > 0
		? JSON.stringify(patterns, null, 2)
		: EMPTY_PATTERNS;
}

function parsePatterns(raw: string): NodeRoutingPreferences["firewall"] {
	if (!raw.trim()) {
		return null;
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new Error("Extra firewall rules must be valid JSON.");
	}
	if (!Array.isArray(value)) {
		throw new Error("Extra firewall rules must be a JSON array.");
	}
	const parsed = parseNodeRoutingPreferences(
		JSON.stringify({ firewall: { custom_patterns: value } })
	);
	if (parsed.firewall?.custom_patterns.length !== value.length) {
		throw new Error(
			"Each rule needs a kind (pii, secret, or prompt_injection), name, and regex."
		);
	}
	return parsed.firewall;
}

/**
 * Node-owned preferences that travel with requests sent to the managed fleet.
 * The fleet clamps fallback order to its own funded chain and treats firewall
 * entries as additive, so this card never grants a node authority over org
 * budget, provider keys, or locked policy.
 */
export function NodeRoutingSettings() {
	const [fallback, setFallback] = useState("");
	const [patterns, setPatterns] = useState(EMPTY_PATTERNS);
	const [loaded, setLoaded] = useState(false);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		let cancelled = false;
		getNodeRoutingPreferences(toTarget(useNodeStore.getState().getActiveNode()))
			.then((prefs) => {
				if (!cancelled) {
					setFallback(prefs.fallback.join(", "));
					setPatterns(patternsText(prefs));
					setLoaded(true);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setLoaded(true);
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const save = async () => {
		let firewall: NodeRoutingPreferences["firewall"];
		try {
			firewall = parsePatterns(patterns);
		} catch (error) {
			sileo.error({
				title: "Could not save routing preferences",
				description:
					error instanceof Error ? error.message : "Invalid firewall rules",
			});
			return;
		}

		setSaving(true);
		const prefs: NodeRoutingPreferences = {
			fallback: fallback
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean),
			firewall,
		};
		const ok = await setNodeRoutingPreferences(
			toTarget(useNodeStore.getState().getActiveNode()),
			prefs
		);
		setSaving(false);
		sileo[ok ? "success" : "error"]({
			title: ok
				? "Routing preferences saved"
				: "Failed to save routing preferences",
			description: ok
				? "Managed requests will carry these preferences immediately. The fleet still enforces your organization's budget and guardrails."
				: "Core did not accept the change.",
		});
	};

	return (
		<SettingsSection
			caption="These are node preferences for managed requests, not policy controls. The hosted fleet keeps the organization budget, provider allowlist, entitlement, and locked guardrails; it may ignore a fallback that is not in its funded chain."
			title="Managed request routing"
		>
			<SettingsGroup>
				<SettingsItem title="Preferred fallback providers">
					<Input
						autoComplete="off"
						disabled={!loaded}
						onChange={(event) => setFallback(event.target.value)}
						placeholder="anthropic, openrouter, local"
						value={fallback}
					/>
					<p className="text-muted-foreground text-xs">
						Comma-separated gateway provider ids. The primary fleet route stays
						first; this only reorders eligible fallbacks.
					</p>
				</SettingsItem>
				<SettingsItem title="Extra firewall rules">
					<Textarea
						aria-label="Extra firewall rules JSON"
						className="min-h-32 font-mono text-xs"
						disabled={!loaded}
						onChange={(event) => setPatterns(event.target.value)}
						placeholder={
							'[{"kind":"secret","name":"internal_id","regex":"..."}]'
						}
						value={patterns}
					/>
					<p className="text-muted-foreground text-xs">
						Optional JSON array of rules with <code>kind</code>,{" "}
						<code>name</code>, and <code>regex</code>. Rules are additive and
						cannot loosen fleet policy. Leave blank to clear them.
					</p>
				</SettingsItem>
				<div className="flex justify-end">
					<Button disabled={!loaded || saving} onClick={save} size="sm">
						{saving ? "Saving…" : "Save routing preferences"}
					</Button>
				</div>
			</SettingsGroup>
		</SettingsSection>
	);
}
