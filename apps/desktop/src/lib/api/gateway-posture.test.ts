import { describe, expect, it } from "bun:test";
import type { GatewayFirewallConfig } from "./gateway.ts";
import {
	approvalModeForPosture,
	firewallForPosture,
	parseApprovalMode,
	parseExecApprovalEnabled,
	parseSavedPosture,
	resolveGatewayPosture,
} from "./gateway-posture.ts";

function firewall(
	overrides: Partial<GatewayFirewallConfig> = {}
): GatewayFirewallConfig {
	return {
		enabled: true,
		scan_inbound: true,
		scan_outbound: true,
		log_detections: true,
		redact_pii: true,
		redact_secrets: true,
		wrap_untrusted_tool_results: true,
		policy: "block",
		custom_patterns: [],
		...overrides,
	};
}

describe("gateway posture mapping", () => {
	it("keeps Balanced as the safe shipped default", () => {
		expect(
			resolveGatewayPosture({
				approvalMode: "smart",
				execApprovalEnabled: true,
				firewall: firewall(),
			})
		).toBe("balanced");
	});

	it.each([
		["guarded", "manual", "block"],
		["balanced", "smart", "block"],
		["autonomous", "off", "sanitize"],
	] as const)("maps %s to coordinated Core and Gateway controls", (posture, approval, policy) => {
		expect(approvalModeForPosture(posture)).toBe(approval);
		expect(
			resolveGatewayPosture({
				approvalMode: approval,
				execApprovalEnabled: true,
				firewall: firewall({ policy }),
			})
		).toBe(posture);
	});

	it("marks weakened guardrails as Custom instead of relabeling them", () => {
		expect(
			resolveGatewayPosture({
				approvalMode: "smart",
				execApprovalEnabled: true,
				firewall: firewall({ redact_secrets: false }),
			})
		).toBe("custom");
		expect(
			resolveGatewayPosture({
				approvalMode: "smart",
				execApprovalEnabled: false,
				firewall: firewall(),
			})
		).toBe("custom");
	});

	it("preserves user patterns while restoring non-negotiable invariants", () => {
		const current = firewall({
			enabled: false,
			scan_inbound: false,
			redact_pii: false,
			wrap_untrusted_tool_results: false,
			custom_patterns: [
				{ kind: "secret", name: "internal", regex: "internal-[0-9]+" },
			],
		});
		const applied = firewallForPosture(current, "autonomous");
		expect(applied.custom_patterns).toEqual(current.custom_patterns);
		expect(applied.enabled).toBe(true);
		expect(applied.scan_inbound).toBe(true);
		expect(applied.scan_outbound).toBe(true);
		expect(applied.redact_pii).toBe(true);
		expect(applied.redact_secrets).toBe(true);
		expect(applied.wrap_untrusted_tool_results).toBe(true);
		expect(applied.policy).toBe("sanitize");
	});
});

describe("gateway posture wire parsing", () => {
	it("normalizes stored values and defaults unknown approval modes to Smart", () => {
		expect(parseSavedPosture("  AUTONOMOUS ")).toBe("autonomous");
		expect(parseSavedPosture("custom")).toBeNull();
		expect(parseApprovalMode(null)).toBe("smart");
		expect(parseApprovalMode("MANUAL")).toBe("manual");
		expect(parseApprovalMode("unknown")).toBe("smart");
		expect(parseExecApprovalEnabled("off")).toBe(false);
		expect(parseExecApprovalEnabled(null)).toBe(true);
	});
});
