/* eslint-disable react/no-unknown-property */
"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { cn } from "@ryu/ui/lib/utils";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

import "./ryu-logo-model.css";

const RYU_MODEL_SCALE = 0.22;
const RYU_BODY_DEPTH = 1.45;

/**
 * The same Ryu outline used by the shared logo, mapped into Three's Y-up
 * coordinate system. The eye paths are holes in the extrusion, so the
 * background really passes through them instead of being painted over.
 */
function createRyuShape() {
	const shape = new THREE.Shape();

	shape.moveTo(12, 0);
	shape.bezierCurveTo(21.2, 0, 24.9, 4.8, 24.4, 14.6);
	shape.bezierCurveTo(24.1, 23.7, 12.8, 27.7, 8.8, 18.6);
	shape.bezierCurveTo(6.6, 12.9, 9.9, 10.7, 5.9, 6);
	shape.bezierCurveTo(5, 4.9, 4.1, 4, 3.2, 2.9);
	shape.bezierCurveTo(2, 1.6, 3.9, 0.7, 5.1, 0.7);
	shape.bezierCurveTo(7.4, 0.7, 9.7, 0, 12, 0);

	const leftEye = new THREE.Path();
	leftEye.absellipse(15, 14, 1.5, 3, 0, Math.PI * 2, true, 0);
	const rightEye = new THREE.Path();
	rightEye.absellipse(19, 14, 1.5, 3, 0, Math.PI * 2, true, 0);
	shape.holes.push(leftEye, rightEye);

	return shape;
}

const RYU_SHAPE = createRyuShape();

function RyuLogoMesh({ isDark }: { isDark: boolean }) {
	const geometry = useMemo(() => {
		const extruded = new THREE.ExtrudeGeometry(RYU_SHAPE, {
			bevelEnabled: true,
			bevelSegments: 4,
			bevelSize: 0.16,
			bevelThickness: 0.2,
			curveSegments: 32,
			depth: RYU_BODY_DEPTH,
		});
		extruded.center();
		extruded.computeVertexNormals();
		return extruded;
	}, []);

	useEffect(() => () => geometry.dispose(), [geometry]);

	return (
		<mesh castShadow geometry={geometry} receiveShadow scale={RYU_MODEL_SCALE}>
			<meshPhysicalMaterial
				clearcoat={0.48}
				clearcoatRoughness={0.22}
				color={isDark ? "#f1f1ef" : "#17181b"}
				metalness={0.22}
				roughness={0.24}
			/>
		</mesh>
	);
}

function RyuLogoScene({
	isDark,
	isDragging,
	onDragEnd,
	onDragStart,
	reducedMotion,
}: {
	isDark: boolean;
	isDragging: boolean;
	onDragEnd: () => void;
	onDragStart: () => void;
	reducedMotion: boolean;
}) {
	return (
		<>
			<ambientLight intensity={1.2} />
			<hemisphereLight
				args={[
					isDark ? "#ffffff" : "#d7d7dc",
					isDark ? "#151519" : "#8d8d96",
					1.5,
				]}
			/>
			<directionalLight
				castShadow
				color="#ffffff"
				intensity={3.4}
				position={[4, 6, 8]}
			/>
			<pointLight
				color={isDark ? "#bfd8ff" : "#ffffff"}
				intensity={18}
				position={[-4, 1, 5]}
			/>
			<pointLight
				color={isDark ? "#d9b9ff" : "#dfe5ff"}
				intensity={12}
				position={[4, -2, -4]}
			/>

			<group rotation={[0.06, -0.24, 0]}>
				<RyuLogoMesh isDark={isDark} />
			</group>

			<OrbitControls
				autoRotate={!(reducedMotion || isDragging)}
				autoRotateSpeed={0.7}
				dampingFactor={0.08}
				enableDamping
				enablePan={false}
				enableZoom={false}
				maxPolarAngle={Math.PI / 2 + 0.62}
				minPolarAngle={Math.PI / 2 - 0.62}
				onEnd={onDragEnd}
				onStart={onDragStart}
				rotateSpeed={0.72}
			/>
		</>
	);
}

function useThemeIsDark() {
	const [isDark, setIsDark] = useState(false);

	useEffect(() => {
		const root = document.documentElement;
		const update = () => setIsDark(root.classList.contains("dark"));
		const observer = new MutationObserver(update);
		update();
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);

	return isDark;
}

function useReducedMotion() {
	const [reducedMotion, setReducedMotion] = useState(false);

	useEffect(() => {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReducedMotion(query.matches);
		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);

	return reducedMotion;
}

interface RyuLogoModelProps {
	className?: string;
}

export default function RyuLogoModel({ className }: RyuLogoModelProps) {
	const isDark = useThemeIsDark();
	const reducedMotion = useReducedMotion();
	const [isDragging, setIsDragging] = useState(false);

	return (
		<figure className={cn("ryu-logo-model", className)}>
			<div
				aria-label="Interactive three-dimensional filled Ryu logo with transparent eyes"
				className="ryu-logo-model__stage"
				data-dragging={isDragging}
				role="img"
			>
				<div aria-hidden="true" className="ryu-logo-model__atmosphere" />
				<div aria-hidden="true" className="ryu-logo-model__orbit" />
				<Canvas
					camera={{ fov: 36, position: [0, 0, 11] }}
					className="ryu-logo-model__canvas"
					dpr={[1, 2]}
					gl={{ alpha: true, antialias: true }}
					shadows
				>
					<RyuLogoScene
						isDark={isDark}
						isDragging={isDragging}
						onDragEnd={() => setIsDragging(false)}
						onDragStart={() => setIsDragging(true)}
						reducedMotion={reducedMotion}
					/>
				</Canvas>
				<div aria-hidden="true" className="ryu-logo-model__shadow" />
			</div>
			<figcaption className="ryu-logo-model__caption">
				<span>
					<strong>Ryu / Filled form</strong>
					<br />
					Body solid · eyes transparent
				</span>
				<span className="ryu-logo-model__hint">
					{isDragging ? "Release to let it drift" : "Drag to rotate"}
				</span>
			</figcaption>
			<p className="sr-only">
				This is a real 3D model. Drag the logo to rotate it and inspect the
				transparent eye cutouts.
			</p>
		</figure>
	);
}

export function RyuLogoSection() {
	return (
		<section
			aria-labelledby="ryu-logo-form-title"
			className="container mx-auto w-full px-4"
		>
			<div className="mx-auto grid max-w-6xl items-center gap-8 border-border/60 border-t pt-16 md:grid-cols-[minmax(0,0.82fr)_minmax(22rem,1.18fr)] md:gap-12 md:pt-20">
				<div className="max-w-md space-y-5">
					<p className="font-mono text-muted-foreground text-xs uppercase tracking-[0.18em]">
						The filled mark
					</p>
					<h2
						className="text-balance font-medium text-2xl tracking-tight md:text-3xl"
						id="ryu-logo-form-title"
					>
						A solid body. Open eyes.
					</h2>
					<p className="text-muted-foreground text-sm leading-6">
						The filled Ryu form gives the mark weight while the transparent eyes
						keep it alive against any surface. Drag the model to see the depth
						and open cutouts from every angle.
					</p>
					<div className="flex flex-wrap gap-2 font-mono text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
						<span className="rounded-full border border-border/70 px-3 py-1.5">
							3D form
						</span>
						<span className="rounded-full border border-border/70 px-3 py-1.5">
							Drag enabled
						</span>
					</div>
				</div>
				<RyuLogoModel />
			</div>
		</section>
	);
}
