/** True only for the concrete client that already inserted the message optimistically. */
export function isRealtimeMessageEcho(
	messageClientId: string | null | undefined,
	localClientId: string
): boolean {
	return localClientId.length > 0 && messageClientId === localClientId;
}
