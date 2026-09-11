import {
	Group,
	Mesh,
	type MeshPhysicalMaterial,
	type SphereGeometry,
	Vector3,
} from "three";
import {
	type ExpressiveExpressionSelection,
	expressiveFrame,
	type ResolvedExpressiveFrame,
} from "./expressive.ts";

import { sampleGhostSurface } from "./logo-3d-geometry.ts";

/** Raised, surface-mounted eyes driven by the same controls as the 2D face. */
export function createGhostFace(
	_body: Mesh,
	geometry: SphereGeometry,
	material: MeshPhysicalMaterial,
	eyeScale: number
) {
	const group = new Group();
	const eyes = [new Group(), new Group()];
	for (const eye of eyes) {
		eye.add(
			new Mesh(geometry, material),
			new Mesh(geometry, material),
			new Mesh(geometry, material)
		);
		group.add(eye);
	}
	const updateFrame = (frame: ResolvedExpressiveFrame) => {
		const roll = (-frame.gaze.roll * Math.PI) / 180;
		for (const [index, eye] of eyes.entries()) {
			const control = frame.eyes[index];
			if (!control) {
				continue;
			}
			const offset = ((index === 0 ? -1 : 1) * frame.gap) / 2;
			const x = 2.6 + frame.gaze.x + offset * Math.cos(roll);
			const y = 2 - frame.gaze.y + offset * Math.sin(roll);
			const hit = sampleGhostSurface(x, y);
			eye.visible = Boolean(hit);
			if (!hit) {
				continue;
			}
			eye.position.copy(hit.position).addScaledVector(hit.normal, 0.15);
			eye.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), hit.normal);
			eye.rotateZ(roll - (control.tilt * Math.PI) / 180);
			const scale = Math.max(0.1, eyeScale) * 0.75;
			for (const [part, mesh] of eye.children.entries()) {
				mesh.visible = control.shape === "x" ? part > 0 : part === 0;
				if (part === 0) {
					mesh.scale.set(
						control.width * scale,
						control.height * control.open * scale,
						0.65
					);
				} else {
					mesh.scale.set(0.27 * scale, control.height * scale, 0.38);
					mesh.rotation.z = ((part === 1 ? 1 : -1) * Math.PI) / 4;
				}
			}
		}
		return frame.id;
	};
	const update = (selection: ExpressiveExpressionSelection) =>
		updateFrame(expressiveFrame(selection));
	return { group, update, updateFrame };
}
