import { expect, test } from "bun:test";
import { isRealtimeMessageEcho } from "./message-origin.ts";

test("same user on another client is not mistaken for an optimistic echo", () => {
	expect(isRealtimeMessageEcho("desktop-b", "desktop-a")).toBe(false);
	expect(isRealtimeMessageEcho("desktop-a", "desktop-a")).toBe(true);
	expect(isRealtimeMessageEcho(null, "desktop-a")).toBe(false);
	expect(isRealtimeMessageEcho("", "")).toBe(false);
});
