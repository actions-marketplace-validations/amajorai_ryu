// apps/desktop/src/lib/api/encryption.ts
//
// Typed client for Core's at-rest encryption posture (`/api/encryption/status`).
// All crypto lives in Core (`ryu_crypto` + the per-store seal/open call sites);
// this is a read-only view for the Gateway settings → Encryption tab. The
// endpoint never returns key material in any form, so neither does this module.

import { type ApiTarget, request } from "./client.ts";

/** Which custody path the running Core resolved its master key from. */
export type MasterKeySource = "env" | "keychain" | "file";

/** Coverage verdict for one store. */
export type StoreEncryptionStatus = "sealed" | "partial" | "plaintext";

/** Non-secret description of how this node holds its at-rest master key. */
export interface KeyCustody {
	/** False when the key could not be loaded at all — sealed stores refuse to open. */
	available: boolean;
	/** Env var consulted first. */
	envVar: string;
	/** Why the key is unavailable, when it is. */
	error: string | null;
	/** Profile-scoped keychain account (`master-key`, `master-key-dev`, …). */
	keychainAccount: string | null;
	/** Keychain service name. */
	keychainService: string | null;
	/** Path of the file-fallback key — set only when the file IS the live source. */
	keyFile: string | null;
	/** A legacy `memory.key` still sitting in the data folder. */
	legacyMemoryKeyPresent: boolean;
	source: MasterKeySource | null;
}

/** One row of the per-store coverage table. */
export interface StoreCoverage {
	/** Plain-language explanation of what is and isn't protected here. */
	detail: string;
	id: string;
	label: string;
	/** Measured sealed rows, when the store can be counted cheaply. */
	sealed: number | null;
	status: StoreEncryptionStatus;
	/** Rows that exist, when countable. */
	total: number | null;
}

export interface EncryptionStatus {
	dataDir: string;
	key: KeyCustody;
	stores: StoreCoverage[];
}

/** Read this node's at-rest encryption posture: key custody + store coverage. */
export function fetchEncryptionStatus(
	target: ApiTarget
): Promise<EncryptionStatus> {
	return request<EncryptionStatus>(target, "/api/encryption/status");
}
