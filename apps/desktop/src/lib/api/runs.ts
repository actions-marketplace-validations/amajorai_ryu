// Desktop compatibility entrypoint for the shared Core run-trace client.
// Keep this path stable for existing desktop consumers while the transport and
// wire normalization live in the platform-agnostic core-client package.
export {
	fetchRunTrace,
	type RunSpan,
} from "@ryuhq/core-client/runs";
