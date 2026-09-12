import { expect, test } from "bun:test";
import { Vector3 } from "three";
import { createGhostGeometry } from "./logo-3d-geometry.ts";

test("ghost is a closed outward-facing volume with curved front and back", () => {
	const geometry = createGhostGeometry();
	const positions = geometry.getAttribute("position");
	const indices = geometry.getIndex();
	if (!indices) {
		throw new Error("Expected indexed geometry");
	}
	const edges = new Map<string, number>();
	const a = new Vector3();
	const b = new Vector3();
	const c = new Vector3();
	let volume = 0;
	for (let index = 0; index < indices.count; index += 3) {
		const triangle = [
			indices.getX(index),
			indices.getX(index + 1),
			indices.getX(index + 2),
		] as const;
		a.fromBufferAttribute(positions, triangle[0]);
		b.fromBufferAttribute(positions, triangle[1]);
		c.fromBufferAttribute(positions, triangle[2]);
		volume += a.dot(b.cross(c)) / 6;
		for (let edge = 0; edge < 3; edge += 1) {
			const start = triangle[edge];
			const end = triangle[(edge + 1) % 3];
			if (start === undefined || end === undefined) {
				throw new Error("Missing edge");
			}
			const key = `${Math.min(start, end)}:${Math.max(start, end)}`;
			edges.set(key, (edges.get(key) ?? 0) + 1);
		}
	}
	expect(new Set(edges.values())).toEqual(new Set([2]));
	expect(volume).toBeGreaterThan(1000);
	geometry.computeBoundingBox();
	expect(geometry.boundingBox?.min.z).toBeLessThan(-6.5);
	expect(geometry.boundingBox?.max.z).toBeGreaterThan(6.5);
	const depths = new Set(
		Array.from({ length: positions.count }, (_, i) => positions.getZ(i))
	);
	expect(depths.size).toBeGreaterThan(40);
	geometry.dispose();
});

test("surface normals remain continuous across the tail and face", () => {
	const geometry = createGhostGeometry();
	const normals = geometry.getAttribute("normal");
	const indices = geometry.getIndex();
	if (!indices) {
		throw new Error("Expected indexed geometry");
	}
	let minimumAlignment = 1;
	for (let index = 0; index < indices.count; index += 3) {
		for (let edge = 0; edge < 3; edge += 1) {
			const a = indices.getX(index + edge);
			const b = indices.getX(index + ((edge + 1) % 3));
			minimumAlignment = Math.min(
				minimumAlignment,
				normals.getX(a) * normals.getX(b) +
					normals.getY(a) * normals.getY(b) +
					normals.getZ(a) * normals.getZ(b)
			);
		}
	}
	// The unsmoothed radial inflation dips below 0.901 at the tail ridge.
	expect(minimumAlignment).toBeGreaterThan(0.92);
	geometry.dispose();
});
