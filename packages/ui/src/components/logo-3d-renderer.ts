import { type Camera, type Scene, WebGLRenderer } from "three";

interface RendererPool {
	canvases: Set<HTMLCanvasElement>;
	height: number;
	lost: (event: Event) => void;
	renderer: WebGLRenderer;
	width: number;
}
let pool: RendererPool | undefined;

/** One WebGL context serves every ghost; each visible canvas holds its own frame.
 * Avatars in long transcripts must not exhaust the browser's context limit.
 */
export function createGhostRenderer() {
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Canvas rendering is unavailable");
	}
	if (!pool) {
		const renderer = new WebGLRenderer({
			alpha: true,
			antialias: true,
			preserveDrawingBuffer: true,
		});
		renderer.setSize(1, 1, false);
		const canvases = new Set<HTMLCanvasElement>();
		const current: RendererPool = {
			renderer,
			width: 1,
			height: 1,
			canvases,
			lost: (event) => {
				event.preventDefault();
				if (pool === current) {
					pool = undefined;
				}
				for (const target of canvases) {
					target.dispatchEvent(
						new Event("webglcontextlost", { cancelable: true })
					);
				}
			},
		};
		renderer.domElement.addEventListener("webglcontextlost", current.lost);
		pool = current;
	}
	const current = pool;
	current.canvases.add(canvas);
	let pixelRatio = 1;
	let width = 1;
	let height = 1;
	let disposed = false;
	return {
		domElement: canvas,
		setPixelRatio(value: number) {
			pixelRatio = value;
		},
		setSize(nextWidth: number, nextHeight: number, _updateStyle?: boolean) {
			width = Math.max(1, Math.round(nextWidth * pixelRatio));
			height = Math.max(1, Math.round(nextHeight * pixelRatio));
			canvas.width = width;
			canvas.height = height;
		},
		render(scene: Scene, camera: Camera) {
			if (disposed) {
				return;
			}
			if (width > current.width || height > current.height) {
				current.width = Math.max(width, current.width);
				current.height = Math.max(height, current.height);
				current.renderer.setSize(current.width, current.height, false);
			}
			current.renderer.setViewport(0, 0, width, height);
			current.renderer.render(scene, camera);
			context.clearRect(0, 0, width, height);
			context.drawImage(
				current.renderer.domElement,
				0,
				current.height - height,
				width,
				height,
				0,
				0,
				width,
				height
			);
		},
		dispose() {
			if (disposed) {
				return;
			}
			disposed = true;
			current.canvases.delete(canvas);
			if (current.canvases.size === 0) {
				current.renderer.domElement.removeEventListener(
					"webglcontextlost",
					current.lost
				);
				current.renderer.dispose();
				current.renderer.forceContextLoss();
				if (pool === current) {
					pool = undefined;
				}
			}
		},
		// A consumer releases its lease; only the last lease destroys the context.
		forceContextLoss() {},
	};
}
