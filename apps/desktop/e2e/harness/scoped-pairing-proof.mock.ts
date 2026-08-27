interface PairingConstraints {
	org_id?: string;
	plugin_id?: string;
	team_id?: string;
	tool_name?: string;
}

interface PendingRequest {
	client_name: string;
	created_at: number;
	requested_constraints: PairingConstraints;
	requested_expires_at: number;
	requested_scopes: string[];
	user_code: string;
}

interface PairedClient {
	active?: boolean;
	constraints?: PairingConstraints;
	created_at: number;
	expires_at?: number | null;
	granted_scopes: string[];
	id: string;
	last_seen: number;
	name: string;
	revoked_at?: number | null;
	schema_version: number;
}

interface ProofApproval {
	granted_scopes: string[];
	user_code: string;
}

interface RequestOptions {
	body?: unknown;
	method?: string;
}

interface RequestTarget {
	token: string | null;
	url: string;
}

const NOW_SECONDS = Math.floor(Date.now() / 1000);
const OWNER_TOKEN = "owner-proof-token";
const REQUEST_CODE = "J7K-PQM";

let pending: PendingRequest[] = [
	{
		client_name: "Research browser",
		created_at: NOW_SECONDS - 60,
		requested_constraints: {
			org_id: "org-proof",
			plugin_id: "com.ryu.search",
			team_id: "team-proof",
			tool_name: "search",
		},
		requested_expires_at: NOW_SECONDS + 86_400,
		requested_scopes: ["chat:read", "chat:write", "tools:read"],
		user_code: REQUEST_CODE,
	},
];

let clients: PairedClient[] = [
	{
		constraints: { org_id: "org-proof", plugin_id: "com.ryu.vscode" },
		created_at: NOW_SECONDS - 7200,
		expires_at: NOW_SECONDS + 172_800,
		granted_scopes: ["tools:read", "gateway:route"],
		id: "client-vscode",
		last_seen: NOW_SECONDS - 15,
		name: "VS Code MCP",
		revoked_at: null,
		schema_version: 2,
	},
	{
		constraints: { org_id: "org-proof" },
		created_at: NOW_SECONDS - 172_800,
		expires_at: NOW_SECONDS - 30,
		granted_scopes: ["chat:read"],
		id: "client-ci",
		last_seen: NOW_SECONDS - 7200,
		name: "Expired CI runner",
		revoked_at: null,
		schema_version: 2,
	},
	{
		active: false,
		constraints: { team_id: "team-proof" },
		created_at: NOW_SECONDS - 3600,
		expires_at: NOW_SECONDS + 172_800,
		granted_scopes: ["chat:read"],
		id: "client-idle",
		last_seen: NOW_SECONDS - 1800,
		name: "Inactive tablet",
		revoked_at: null,
		schema_version: 2,
	},
	{
		constraints: { org_id: "org-proof" },
		created_at: NOW_SECONDS - 200_000,
		expires_at: null,
		granted_scopes: ["files:read"],
		id: "client-old",
		last_seen: NOW_SECONDS - 190_000,
		name: "Revoked browser",
		revoked_at: NOW_SECONDS - 180_000,
		schema_version: 2,
	},
];

function clone<T>(value: T): T {
	return structuredClone(value);
}

function assertOwner(target: RequestTarget): void {
	if (target.url !== "http://proof.local" || target.token !== OWNER_TOKEN) {
		throw new Error("pairing proof did not use the active owner target");
	}
}

const proofState = {
	lastApproval: null as ProofApproval | null,
	lastRevokedClientId: null as string | null,
};

Object.defineProperty(window, "__SCOPED_PAIRING_PROOF__", {
	configurable: true,
	value: proofState,
});

export function useActiveNode(): {
	id: string;
	name: string;
	token: string;
	url: string;
} {
	return {
		id: "proof-node",
		name: "Secure workstation",
		token: OWNER_TOKEN,
		url: "http://proof.local",
	};
}

export async function invoke<T>(command: string): Promise<T> {
	if (command !== "local_node_token") {
		throw new Error(`unexpected Tauri command: ${command}`);
	}
	return { source: "file", token: OWNER_TOKEN } as T;
}

export async function request<T>(
	target: RequestTarget,
	path: string,
	options: RequestOptions = {}
): Promise<T> {
	assertOwner(target);
	const method = options.method?.toUpperCase() ?? "GET";
	if (method === "GET" && path === "/api/pair/requests") {
		return clone({ requests: pending }) as T;
	}
	if (method === "GET" && path === "/api/pair/clients") {
		return clone({ clients }) as T;
	}
	if (method === "POST" && path === "/api/pair/approve") {
		const approval = options.body as ProofApproval;
		const expected: ProofApproval = {
			granted_scopes: ["chat:read", "tools:read"],
			user_code: REQUEST_CODE,
		};
		if (JSON.stringify(approval) !== JSON.stringify(expected)) {
			throw new Error(`unexpected narrowed approval: ${JSON.stringify(approval)}`);
		}
		const approved = pending.find((item) => item.user_code === approval.user_code);
		if (!approved) {
			throw new Error("pending request was already consumed");
		}
		proofState.lastApproval = clone(approval);
		pending = pending.filter((item) => item.user_code !== approval.user_code);
		clients = [
			{
				constraints: clone(approved.requested_constraints),
				created_at: approved.created_at,
				expires_at: approved.requested_expires_at,
				granted_scopes: clone(approval.granted_scopes),
				id: "client-research",
				last_seen: NOW_SECONDS,
				name: approved.client_name,
				revoked_at: null,
				schema_version: 2,
			},
			...clients,
		];
		return { approved: true } as T;
	}
	if (method === "DELETE" && path.startsWith("/api/pair/clients/")) {
		const clientId = decodeURIComponent(path.slice("/api/pair/clients/".length));
		const client = clients.find((item) => item.id === clientId);
		if (!client) {
			throw new Error(`unknown client: ${clientId}`);
		}
		client.revoked_at = NOW_SECONDS;
		proofState.lastRevokedClientId = clientId;
		return { revoked: true } as T;
	}
	throw new Error(`unexpected pairing request: ${method} ${path}`);
}
