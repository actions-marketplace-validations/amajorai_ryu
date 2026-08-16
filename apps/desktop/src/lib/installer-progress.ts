/** The versioned progress envelope emitted by the public one-line installer. */
export interface InstallerProgress {
	component: string;
	error?: string;
	percent?: number;
	phase: "binary" | "bootstrap" | "core" | "defaults" | "error" | "installer";
	status: "complete" | "failed" | "skipped" | "started";
	version: 1;
}

const COMPONENT_LABELS: Record<string, string> = {
	"bundled-defaults": "bundled models, engines, and skills",
	"ryu-cli": "Ryu CLI",
	"ryu-core": "Ryu Core",
	"ryu-gateway": "the model gateway",
};

export function installerComponentLabel(component: string): string {
	return COMPONENT_LABELS[component] ?? component;
}
