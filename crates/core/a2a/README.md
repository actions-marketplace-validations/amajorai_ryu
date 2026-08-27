# ryu-a2a

Core A2A v1 primitives for Ryu. This crate owns protocol types, peer trust,
inbound credentials, task/event persistence, and outbound endpoint policy. It
does not depend on `apps/core`; HTTP routing and agent execution remain in the
Core application.

The transport client discovers and validates v1 Agent Cards, speaks JSON-RPC
and HTTP+JSON (including SSE), covers the task, cancellation, subscription,
push-configuration, and extended-card operations, and delivers authenticated
push notifications with bounded same-origin redirects.

Security-sensitive values are write-only at the management boundary, encrypted
with Ryu's field cipher at rest, and redacted from `Debug` output. Every task
lookup is scoped by tenant and owner. Network clients must validate both the
configured URL and every resolved or redirected destination with
`EndpointPolicy`.
