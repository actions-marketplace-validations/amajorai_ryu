export type SshAuthMode = "identity" | "none";

export interface SshConnection {
	auth: SshAuthMode;
	host: string;
	id: string;
	identityFile?: string;
	name: string;
	port: number;
	username: string;
}

export const SSH_CONNECTIONS_STORAGE_KEY = "ryu:ssh-connections";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function hasControlCharacters(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code < 32 || code === 127) {
			return true;
		}
	}
	return false;
}

function cleanText(value: unknown, maxLength: number): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const text = value.trim();
	if (!text || text.length > maxLength || hasControlCharacters(text)) {
		return null;
	}
	return text;
}

function safeToken(value: unknown, maxLength: number): string | null {
	const text = cleanText(value, maxLength);
	return text && /^[A-Za-z0-9._:\-[\]]+$/.test(text) ? text : null;
}

function safeIdentityPath(value: unknown): string | null {
	return cleanText(value, 4096);
}

function connectionId(): string {
	if (typeof crypto?.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `ssh-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

export function normalizeSshConnection(raw: unknown): SshConnection | null {
	if (!isRecord(raw)) {
		return null;
	}
	const name = cleanText(raw.name, 120);
	const host = safeToken(raw.host, 255);
	const username =
		raw.username === undefined ? "" : safeToken(raw.username, 120);
	const id = safeToken(raw.id, 120);
	const port = typeof raw.port === "number" ? raw.port : Number(raw.port);
	if (
		!(name && host) ||
		username === null ||
		!Number.isInteger(port) ||
		port < 1 ||
		port > 65_535
	) {
		return null;
	}
	const auth: SshAuthMode = raw.auth === "identity" ? "identity" : "none";
	const identityFile = safeIdentityPath(raw.identityFile);
	return {
		auth,
		host,
		id: id ?? connectionId(),
		...(identityFile ? { identityFile } : {}),
		name,
		port,
		username,
	};
}

export function loadSshConnections(): SshConnection[] {
	try {
		const raw = localStorage.getItem(SSH_CONNECTIONS_STORAGE_KEY);
		const parsed = raw ? (JSON.parse(raw) as unknown) : [];
		if (!Array.isArray(parsed)) {
			return [];
		}
		const seen = new Set<string>();
		const connections: SshConnection[] = [];
		for (const item of parsed) {
			const connection = normalizeSshConnection(item);
			if (connection && !seen.has(connection.id)) {
				seen.add(connection.id);
				connections.push(connection);
			}
		}
		return connections;
	} catch {
		return [];
	}
}

export function saveSshConnections(
	connections: readonly SshConnection[]
): void {
	localStorage.setItem(
		SSH_CONNECTIONS_STORAGE_KEY,
		JSON.stringify(connections)
	);
}
