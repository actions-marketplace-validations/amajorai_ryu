import { Color, MeshPhysicalMaterial, SRGBColorSpace } from "three";
import { LOGO_DEFAULT_COLORS, type LogoColors } from "./logo-colors.ts";

/** Let the browser resolve CSS colors, including OKLCH and wide-gamut inputs. */
export function resolveGhostColor(value: string, fallback: string): Color {
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) {
		return new Color(fallback);
	}
	context.fillStyle = fallback;
	context.fillStyle = value;
	context.fillRect(0, 0, 1, 1);
	const pixel = context.getImageData(0, 0, 1, 1).data;
	return new Color().setRGB(
		(pixel[0] ?? 0) / 255,
		(pixel[1] ?? 0) / 255,
		(pixel[2] ?? 0) / 255,
		SRGBColorSpace
	);
}

export function createGhostBodyMaterial(
	style: "solid" | "orb",
	colors: LogoColors = {}
) {
	const palette = { ...LOGO_DEFAULT_COLORS, ...colors };
	const time = { value: 0 };
	const material = new MeshPhysicalMaterial({
		color:
			style === "orb"
				? "#ffffff"
				: resolveGhostColor(colors.bg ?? "#d9dee4", "#d9dee4"),
		roughness: 0.3,
		metalness: 0.08,
		clearcoat: 0.65,
		clearcoatRoughness: 0.25,
	});
	if (style === "orb") {
		const uniforms = {
			ghostTime: time,
			ghostBg: { value: resolveGhostColor(palette.bg, "#f0f1fa") },
			ghostC1: { value: resolveGhostColor(palette.c1, "#c28cff") },
			ghostC2: { value: resolveGhostColor(palette.c2, "#7e8cff") },
			ghostC3: { value: resolveGhostColor(palette.c3, "#5dc5ee") },
		};
		material.customProgramCacheKey = () => "ryu-ghost-orb-v1";
		material.onBeforeCompile = (shader) => {
			Object.assign(shader.uniforms, uniforms);
			shader.vertexShader = shader.vertexShader
				.replace(
					"#include <common>",
					"#include <common>\nvarying vec3 ghostPosition;"
				)
				.replace(
					"#include <begin_vertex>",
					"#include <begin_vertex>\nghostPosition = position / vec3(12.0, 12.0, 7.0);"
				);
			shader.fragmentShader = shader.fragmentShader
				.replace(
					"#include <common>",
					`#include <common>
 varying vec3 ghostPosition;
 uniform float ghostTime;
 uniform vec3 ghostBg;
 uniform vec3 ghostC1;
 uniform vec3 ghostC2;
 uniform vec3 ghostC3;
 vec3 ghostOrbColor(vec3 p) {
  float t=ghostTime;
  p.xy=mat2(cos(t),-sin(t),sin(t),cos(t))*p.xy;
  vec3 q=p+0.3*vec3(sin(p.y*2.4+t),sin(p.z*2.2-t),cos(p.x*2.0+t));
  float a=exp(-2.0*dot(q-vec3(-0.6,0.65,0.6),q-vec3(-0.6,0.65,0.6)));
  float b=exp(-2.0*dot(q-vec3(0.3,-0.6,0.4),q-vec3(0.3,-0.6,0.4)));
  float c=exp(-2.0*dot(q-vec3(0.7,0.5,-0.5),q-vec3(0.7,0.5,-0.5)));
  vec3 color=(a*ghostC1+b*ghostC2+c*ghostC3)/max(a+b+c,0.0001);
  return mix(color,ghostBg,0.08+0.12*(0.5+0.5*sin(q.z*2.0+t)));
 }`
				)
				.replace(
					"#include <color_fragment>",
					"#include <color_fragment>\ndiffuseColor.rgb *= ghostOrbColor(ghostPosition);"
				);
		};
	}
	return {
		particleColors: [
			resolveGhostColor(palette.c1, "#c28cff"),
			resolveGhostColor(palette.c2, "#7e8cff"),
			resolveGhostColor(palette.c3, "#5dc5ee"),
		],
		material,
		update: (seconds: number, duration: number) => {
			time.value = (seconds * Math.PI * 2) / Math.max(0.1, duration);
		},
	};
}
