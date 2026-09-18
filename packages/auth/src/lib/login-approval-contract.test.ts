import { describe, expect, it } from "bun:test";
import {
	normalizeLoginApprovalUserCode,
	parseLoginApprovalQr,
} from "./login-approval-contract.ts";

describe("login approval QR contract", () => {
	it("parses Better Auth verification URLs and normalizes the user code", () => {
		expect(
			parseLoginApprovalQr("https://app.example/device?user_code=abcd-2345")
		).toEqual({
			userCode: "ABCD2345",
			verificationUri: "https://app.example/device?user_code=abcd-2345",
		});
		expect(normalizeLoginApprovalUserCode(" abcd-2345 ")).toBe("ABCD2345");
	});

	it("rejects unrelated, non-web, and incomplete QR payloads", () => {
		expect(
			parseLoginApprovalQr("https://app.example/account?user_code=ABCD2345")
		).toBeNull();
		expect(
			parseLoginApprovalQr("javascript:alert(1)?user_code=ABCD2345")
		).toBeNull();
		expect(parseLoginApprovalQr("https://app.example/device")).toBeNull();
		expect(parseLoginApprovalQr("ABCD2345")).toBeNull();
	});
});
