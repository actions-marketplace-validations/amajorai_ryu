import { describe, expect, test } from "bun:test";
import { isServerAssignedMessageId } from "./message-reaction-id.ts";

describe("isServerAssignedMessageId", () => {
	test("accepts a Core-minted UUID v4", () => {
		// `uuid::Uuid::new_v4()` in ConversationStore::append_message.
		expect(
			isServerAssignedMessageId("3f2504e0-4f89-41d3-9a0c-0305e82c3301")
		).toBe(true);
		expect(
			isServerAssignedMessageId("3F2504E0-4F89-41D3-9A0C-0305E82C3301")
		).toBe(true);
	});

	test("rejects an AI SDK client id, which is what stops the 404", () => {
		// The AI SDK's generateId yields 16 base58-ish chars, no dashes. Offering
		// the affordance on one of these guarantees a 404: Core ships no retarget
		// fallback on purpose.
		for (const id of [
			"BvgxVqW3aNzyeqDD",
			"um9nG2fP7t6gShQ2",
			"h6ME4FO2B6vmBV3H",
		]) {
			expect(isServerAssignedMessageId(id)).toBe(false);
		}
	});

	test("fails closed on anything unrecognized", () => {
		expect(isServerAssignedMessageId(undefined)).toBe(false);
		expect(isServerAssignedMessageId("")).toBe(false);
		expect(isServerAssignedMessageId("msg-1")).toBe(false);
		// Right shape, wrong alphabet.
		expect(
			isServerAssignedMessageId("zzzzzzzz-4f89-41d3-9a0c-0305e82c3301")
		).toBe(false);
		// Right alphabet, wrong length.
		expect(
			isServerAssignedMessageId("3f2504e0-4f89-41d3-9a0c-0305e82c33")
		).toBe(false);
	});
});
