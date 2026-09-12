import { expect, test } from "bun:test";
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { blendExpressiveFrames, expressiveFrame } from "./expressive.ts";
import {
	EXPRESSIVE_ANIMATION_IDS,
	expressiveAnimationPreviewTime,
} from "./expressive-animation.ts";
import {
	ghostBlinkOpenness,
	sampleGhostAnimation,
} from "./logo-3d-animation.ts";
import { createGhostDecorations } from "./logo-3d-decorations.ts";

test("blinks close and reopen smoothly and respect motion-off and crossed eyes", () => {
	expect(ghostBlinkOpenness(3.7)).toBeCloseTo(1);
	expect(ghostBlinkOpenness(3.81)).toBeCloseTo(0.04);
	expect(ghostBlinkOpenness(3.92)).toBeCloseTo(1);
	const neutral = expressiveFrame("neutral");
	expect(
		sampleGhostAnimation(3.81, "idle", neutral, true).eyes.eyes[0].open
	).toBeCloseTo(0.04);
	expect(
		sampleGhostAnimation(3.81, "idle", neutral, false).eyes.eyes[0].open
	).toBe(1);
	expect(
		sampleGhostAnimation(3.81, "idle", expressiveFrame("dead"), true).eyes
			.eyes[0].open
	).toBe(1);
});

test("every animation yields renderable 3D decorations and valid body transforms", () => {
	const decorations = createGhostDecorations();
	for (const animation of EXPRESSIVE_ANIMATION_IDS) {
		const frame = sampleGhostAnimation(
			expressiveAnimationPreviewTime(animation),
			animation,
			expressiveFrame("neutral"),
			false
		);
		expect(frame.animation).toBe(animation);
		expect(frame.body.scaleX).toBeGreaterThan(0);
		expect(frame.body.scaleY).toBeGreaterThan(0);
		decorations.update(frame.decorations);
		expect(
			decorations.group.children.filter((child) => child.visible).length
		).toBe(frame.decorations.filter((mark) => mark.opacity > 0.001).length);
		decorations.group.traverse((child) => {
			expect(child.position.toArray().every(Number.isFinite)).toBe(true);
			expect(child.scale.toArray().every(Number.isFinite)).toBe(true);
		});
	}
	decorations.dispose();
});

test("wink, burst, and expression interpolation preserve their distinct behavior", () => {
	const neutral = expressiveFrame("neutral");
	const wink = sampleGhostAnimation(0.8, "wink", neutral, true);
	expect(wink.eyes.eyes[0].height).not.toBe(wink.eyes.eyes[1].height);
	const burst = sampleGhostAnimation(1.2, "burst", neutral, false);
	expect(burst.body.scaleX).toBeLessThan(0.3);
	expect(burst.eyeAlpha).toBe(0);
	const scared = expressiveFrame("scared");
	const midpoint = blendExpressiveFrames(neutral, scared, 0.5);
	const blended = sampleGhostAnimation(0, "idle", midpoint, false);
	expect(blended.eyes.eyes[0].width).toBeGreaterThan(neutral.eyes[0].width);
	expect(blended.eyes.eyes[0].width).toBeLessThan(scared.eyes[0].width);
});

test("particle animations use bounded round instances and the chosen body palette", () => {
	const color = new Color("#ff6688");
	const decorations = createGhostDecorations([color]);
	for (const animation of ["orbit", "burst", "comet"] as const) {
		const frame = sampleGhostAnimation(
			expressiveAnimationPreviewTime(animation),
			animation,
			expressiveFrame("neutral"),
			false
		);
		decorations.update(frame.decorations);
		for (const root of decorations.group.children.filter(
			(child) => child.visible
		)) {
			const particles = root.children[0];
			expect(particles instanceof InstancedMesh).toBe(true);
			if (!(particles instanceof InstancedMesh)) {
				throw new Error("Expected particle instances");
			}
			expect(particles.count).toBeGreaterThan(1);
			const material = particles.material;
			if (Array.isArray(material)) {
				throw new Error("Expected one particle material");
			}
			expect(
				"color" in material &&
					material.color instanceof Color &&
					material.color.equals(color)
			).toBe(true);
			for (let index = 0; index < particles.count; index += 1) {
				const matrix = new Matrix4();
				particles.getMatrixAt(index, matrix);
				const position = new Vector3();
				const scale = new Vector3();
				matrix.decompose(position, new Quaternion(), scale);
				expect(position.length()).toBeLessThan(20);
				expect(scale.x).toBeGreaterThan(0);
				expect(scale.x).toBeCloseTo(scale.y);
				expect(scale.y).toBeCloseTo(scale.z);
			}
		}
	}
	decorations.dispose();
});
