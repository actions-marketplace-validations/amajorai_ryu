// Ambient types for the noVNC RFB client (`@novnc/novnc` ships core/rfb.js as ESM
// with no bundled declarations). Only the surface the Virtual Desktop panel uses is
// declared; keep this minimal so an upstream typings release can replace it whole.

declare module "@novnc/novnc" {
	/** noVNC RFB client: connects a WebSocket (RFB-over-WS) to a VNC server and
	 *  renders into a `<canvas>`, forwarding mouse/keyboard events back. */
	export default class RFB {
		constructor(
			target: HTMLCanvasElement,
			url: string,
			options?: { credentials?: Record<string, string> }
		);

		/** Scale the remote framebuffer to the canvas size. */
		scaleViewport: boolean;
		/** Resize the remote session to the canvas size. */
		resizeSession: boolean;

		addEventListener(
			type: string,
			listener: (event: CustomEvent<{ clean?: boolean; message?: string }>) => void
		): void;
		removeEventListener(
			type: string,
			listener: (event: CustomEvent<{ clean?: boolean; message?: string }>) => void
		): void;

		connect(): void;
		disconnect(): void;
	}
}
