import { describe, expect, it } from "bun:test";
import { supportsWebGL } from "./ryu-logo-model.tsx";

describe("supportsWebGL", () => {
	it("accepts WebGL 2 or WebGL 1 contexts", () => {
		expect(
			supportsWebGL(() => ({
				getContext: ((kind: string) =>
					kind === "webgl2" ? {} : null) as HTMLCanvasElement["getContext"],
			}))
		).toBe(true);
		expect(
			supportsWebGL(() => ({
				getContext: ((kind: string) =>
					kind === "webgl" ? {} : null) as HTMLCanvasElement["getContext"],
			}))
		).toBe(true);
	});

	it("falls back when context creation is unavailable or throws", () => {
		expect(
			supportsWebGL(() => ({
				getContext: (() => null) as HTMLCanvasElement["getContext"],
			}))
		).toBe(false);
		expect(
			supportsWebGL(() => {
				throw new Error("blocked");
			})
		).toBe(false);
	});
});
