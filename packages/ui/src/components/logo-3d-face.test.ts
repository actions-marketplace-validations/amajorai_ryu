import { describe, expect, test } from "bun:test";
import {
	Mesh,
	MeshBasicMaterial,
	MeshPhysicalMaterial,
	SphereGeometry,
} from "three";
import { EXPRESSIVE_EXPRESSION_IDS, expressiveFrame } from "./expressive.ts";
import { createGhostFace } from "./logo-3d-face.ts";
import { createGhostGeometry } from "./logo-3d-geometry.ts";

describe("3D expression contract", () => {
	test("every named expression has two surface-mounted eyes with the shared dimensions and shape", () => {
		const bodyGeometry = createGhostGeometry();
		const bodyMaterial = new MeshBasicMaterial();
		const eyeGeometry = new SphereGeometry();
		const eyeMaterial = new MeshPhysicalMaterial();
		const face = createGhostFace(
			new Mesh(bodyGeometry, bodyMaterial),
			eyeGeometry,
			eyeMaterial,
			1
		);
		const signatures = new Set<string>();
		for (const id of EXPRESSIVE_EXPRESSION_IDS) {
			expect(face.update(id)).toBe(id);
			const frame = expressiveFrame(id);
			expect(face.group.children).toHaveLength(2);
			for (const [index, eye] of face.group.children.entries()) {
				const control = frame.eyes[index];
				if (!control) {
					throw new Error("Missing expression eye");
				}
				expect(eye.visible).toBe(true);
				expect(eye.position.z).toBeGreaterThan(4);
				const visible = eye.children.filter((part) => part.visible);
				expect(visible).toHaveLength(control.shape === "x" ? 2 : 1);
				const oval = eye.children[0];
				if (!oval) {
					throw new Error("Missing oval mesh");
				}
				expect(oval.scale.y).toBeCloseTo(control.height * control.open * 0.75);
				expect(oval.scale.x).toBeCloseTo(control.width * 0.75);
			}
			signatures.add(
				JSON.stringify(
					face.group.children.map((eye) => [
						eye.position.toArray(),
						eye.quaternion.toArray(),
						eye.children.map((part) => [part.visible, part.scale.toArray()]),
					])
				)
			);
		}
		expect(signatures.size).toBe(EXPRESSIVE_EXPRESSION_IDS.length);
		expect(face.update("random")).toBe("neutral");
		bodyGeometry.dispose();
		bodyMaterial.dispose();
		eyeGeometry.dispose();
		eyeMaterial.dispose();
	});
});
