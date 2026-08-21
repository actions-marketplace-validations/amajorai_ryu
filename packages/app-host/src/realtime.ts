/**
 * Typed companion bridge for generic application-room realtime.
 *
 * The implementation is installed inside the null-origin iframe by
 * `third-party-plugin.ts`. These types intentionally contain no node target,
 * bearer token, JWT, or websocket URL: the trusted desktop host owns all of
 * those values and exposes only this opaque room connection.
 */

export interface TokenTableEvent {
	data: unknown;
	name: string;
}
export interface TokenTablePresence {
	data: unknown;
}

export interface TokenTableConnectionInfo {
	access: "read" | "write";
	memberId: string;
	presence: unknown[];
	roomId: string;
}

export interface TokenTableConnection extends TokenTableConnectionInfo {
	close(): Promise<void>;
	publish(name: string, data: unknown): Promise<void>;
	publishPresence(data: unknown): Promise<void>;
}

export interface TokenTableConnectHandlers {
	onClose?: (event: { code: number; reason: string }) => void;
	onError?: (error: unknown) => void;
	onEvent?: (event: TokenTableEvent) => void;
	onPresence?: (presence: TokenTablePresence) => void;
}

export interface TokenTableApi {
	connect(
		input: { roomId: string },
		handlers?: TokenTableConnectHandlers
	): Promise<TokenTableConnection>;
}

export interface RyuCompanionWindowApi {
	tokenTable: TokenTableApi;
	[key: string]: unknown;
}

declare global {
	interface Window {
		ryu?: RyuCompanionWindowApi;
	}
}
