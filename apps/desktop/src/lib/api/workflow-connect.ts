import { createWorkflowConnectClient } from "@ryuhq/core-client/composio-triggers";
import { request } from "./client.ts";

// Keep Desktop's refreshing JWT/header transport; domain parsing stays shared.
const client = createWorkflowConnectClient(request);
export const fetchWorkflowConnectBindings = client.list;
export const bindWorkflowConnectTrigger = client.bind;
export const removeWorkflowConnectBinding = client.remove;
