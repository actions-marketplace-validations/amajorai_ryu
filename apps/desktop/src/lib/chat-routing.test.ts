import { describe, expect, it } from "bun:test";
import { modelRoutingFieldsForInterface } from "./chat-routing.ts";

describe("model routing fields", () => {
	it("strips hidden model and ACP pins in Ryu Work", () => {
		expect(
			modelRoutingFieldsForInterface("simple", {
				model: "paid-model",
				acpMode: "plan",
				acpConfig: { effort: "high" },
				acpModel: "local-model",
			})
		).toEqual({});
	});

	it("keeps only the safe approval defaults in Ryu Work", () => {
		expect(
			modelRoutingFieldsForInterface("simple", {
				model: "paid-model",
				acpMode: "plan",
				acpConfig: { effort: "high" },
				acpModel: "local-model",
				simpleApprovalDefaults: {
					mode: "auto",
					config: { approval_policy: "auto" },
				},
			})
		).toEqual({
			acp_mode: "auto",
			acp_config: { approval_policy: "auto" },
		});
	});

	it("keeps explicit routing controls in Code", () => {
		expect(
			modelRoutingFieldsForInterface("expert", {
				model: " paid-model ",
				acpMode: " plan ",
				acpConfig: { effort: "high" },
				acpModel: " local-model ",
			})
		).toEqual({
			model: "paid-model",
			acp_mode: "plan",
			acp_config: { effort: "high" },
			acp_model: "local-model",
		});
	});

	it("does not send empty selections", () => {
		expect(
			modelRoutingFieldsForInterface("expert", {
				model: " ",
				acpMode: null,
				acpConfig: {},
				acpModel: undefined,
			})
		).toEqual({});
	});
});
