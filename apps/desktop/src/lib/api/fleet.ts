import { BACKEND_URL, TOKEN_KEY } from "@/lib/auth-client.ts";
import { type ApiTarget, request } from "@/src/lib/api/client.ts";

const CONTROL_PLANE_BASE = `${BACKEND_URL.replace(/\/$/, "")}/api/control-plane`;
const ENROLLMENT_TOKEN_PATTERN = /^rfe_[0-9a-f]{64}$/;

export const FLEET_NODE_NAME_MAX_LENGTH = 128;
export const FLEET_REQUEST_TIMEOUT_MS = 20_000;

async function withFleetRequestTimeout<T>(
	label: string,
	operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
	const controller = new AbortController();
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timeoutId = setTimeout(() => {
			controller.abort();
			reject(new Error(`${label} timed out after 20 seconds.`));
		}, FLEET_REQUEST_TIMEOUT_MS);
	});
	try {
		return await Promise.race([operation(controller.signal), timeout]);
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	}
}

export function fleetNodeNameError(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return "Enter a name for this node.";
	}
	if (trimmed.length > FLEET_NODE_NAME_MAX_LENGTH) {
		return `Node name must be ${FLEET_NODE_NAME_MAX_LENGTH} characters or fewer.`;
	}
	return null;
}

export type FleetBindingStatus =
	| { enrolled: false; state: "unbound" }
	| {
			enrolled: true;
			managedInferenceReady: boolean;
			nodeId: string;
			organizationId: string;
			organizationName: string | null;
			state: "bound";
	  };

export class NodeAlreadyBoundError extends Error {
	readonly status: Extract<FleetBindingStatus, { enrolled: true }>;

	constructor(status: Extract<FleetBindingStatus, { enrolled: true }>) {
		super(
			`This node is already bound to ${status.organizationName ?? status.organizationId}. Revoke that binding before moving it to another organization.`
		);
		this.name = "NodeAlreadyBoundError";
		this.status = status;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
	value: unknown,
	field: "nodeId" | "organizationId"
): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Fleet status is missing ${field}. Update Core and retry.`);
	}
	return value;
}

export function parseFleetBindingStatus(value: unknown): FleetBindingStatus {
	if (!isRecord(value) || typeof value.enrolled !== "boolean") {
		throw new Error("Core returned an invalid Fleet status response.");
	}
	if (!value.enrolled) {
		return { enrolled: false, state: "unbound" };
	}
	return {
		enrolled: true,
		managedInferenceReady: value.managedInferenceReady === true,
		nodeId: requiredString(value.nodeId, "nodeId"),
		organizationId: requiredString(value.organizationId, "organizationId"),
		organizationName:
			typeof value.organizationName === "string" &&
			value.organizationName.trim().length > 0
				? value.organizationName
				: null,
		state: "bound",
	};
}

function sessionToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
}

async function cloudError(response: Response): Promise<string> {
	const fallback = `Could not create enrollment code (${response.status}).`;
	const value: unknown = await response.json().catch(() => null);
	if (!isRecord(value)) {
		return fallback;
	}
	if (typeof value.message === "string" && value.message.trim()) {
		return value.message;
	}
	if (typeof value.error === "string" && value.error.trim()) {
		return value.error;
	}
	return fallback;
}

async function issueEnrollmentCode(input: {
	name: string;
	organizationId: string;
}): Promise<string> {
	return withFleetRequestTimeout(
		"Creating the enrollment code",
		async (signal) => {
			const token = sessionToken();
			if (!token) {
				throw new Error("Sign in before binding this node to an organization.");
			}
			const response = await fetch(
				`${CONTROL_PLANE_BASE}/orgs/${encodeURIComponent(input.organizationId)}/nodes/enrollment-tokens`,
				{
					body: JSON.stringify({ kind: "byod", name: input.name }),
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					method: "POST",
					signal,
				}
			);
			if (!response.ok) {
				throw new Error(await cloudError(response));
			}
			const value: unknown = await response.json();
			if (
				!(
					isRecord(value) &&
					typeof value.token === "string" &&
					ENROLLMENT_TOKEN_PATTERN.test(value.token)
				)
			) {
				throw new Error(
					"The control plane returned an invalid enrollment code."
				);
			}
			return value.token;
		}
	);
}

export async function getFleetBindingStatus(
	target: ApiTarget
): Promise<FleetBindingStatus> {
	return withFleetRequestTimeout("Reading Fleet status", async (signal) =>
		parseFleetBindingStatus(
			await request<unknown>(target, "/api/fleet/status", { signal })
		)
	);
}

/**
 * Bind the active self-hosted Core to one organization without exposing the
 * short-lived enrollment secret to component state, logs, or the clipboard.
 */
export async function bindSelfHostedNodeToOrganization(input: {
	name: string;
	organizationId: string;
	target: ApiTarget;
}): Promise<Extract<FleetBindingStatus, { enrolled: true }>> {
	const name = input.name.trim();
	const nameError = fleetNodeNameError(input.name);
	if (nameError) {
		throw new Error(nameError);
	}
	if (!input.organizationId.trim()) {
		throw new Error("Select an organization.");
	}

	const current = await getFleetBindingStatus(input.target);
	if (current.enrolled) {
		throw new NodeAlreadyBoundError(current);
	}

	const token = await issueEnrollmentCode({
		name,
		organizationId: input.organizationId,
	});
	await withFleetRequestTimeout("Enrolling this node", (signal) =>
		request<unknown>(input.target, "/api/fleet/enroll", {
			body: {
				controlPlaneUrl: BACKEND_URL.replace(/\/$/, ""),
				token,
			},
			method: "POST",
			signal,
		})
	);

	const bound = await getFleetBindingStatus(input.target);
	if (!bound.enrolled) {
		throw new Error("Core accepted enrollment but did not save the binding.");
	}
	return bound;
}
