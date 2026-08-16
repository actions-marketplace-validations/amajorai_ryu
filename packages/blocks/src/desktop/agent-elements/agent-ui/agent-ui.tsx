// <AgentUI/> — renders an agent-emitted json-render spec into `@ryu/ui` components.
//
// Resilience is the priority: a malformed or partial spec must never crash the
// chat. We do a light structural check and fall back to a readable error + the raw
// JSON, render unknown component types through a small inert fallback, and wrap the
// renderer in an error boundary as a final backstop. We intentionally do NOT gate on
// `catalog.validate()` — it requires a `visible` field on every element, which valid
// model output omits; `<Renderer>` is lenient and treats missing fields as defaults.

import {
	ActionProvider,
	type ComponentRenderProps,
	JSONUIProvider,
	Renderer,
	type Spec,
	StateProvider,
} from "@json-render/react";
import { cn } from "@ryu/ui/lib/utils.ts";
import { Component, type ReactNode, useCallback, useState } from "react";
import { registry } from "./registry.tsx";
import { AgentUiSubmissionStateProvider } from "./submission-context.tsx";

// A spec is renderable when it is an object naming a root element key and an
// elements map. Prop-level mistakes are tolerated by the renderer, not rejected here.
function isRenderableSpec(spec: unknown): spec is Spec {
	if (typeof spec !== "object" || spec === null) {
		return false;
	}
	const candidate = spec as Record<string, unknown>;
	return (
		typeof candidate.root === "string" &&
		typeof candidate.elements === "object" &&
		candidate.elements !== null
	);
}

// Rendered for any element whose `type` is not in the registry — keep it inert and
// quiet rather than throwing, so one bad node doesn't sink the whole UI.
function UnknownComponent({ element }: ComponentRenderProps) {
	return (
		<span className="text-muted-foreground text-xs">
			[unknown component: {String(element.type)}]
		</span>
	);
}

interface AgentUIProps {
	className?: string;
	/** Receives values from the spec's `submit` action. */
	onSubmit?: (value: unknown) => void | Promise<void>;
	/** The json-render spec emitted by the agent (tool input). */
	spec: unknown;
	/** Optional heading shown above the rendered UI. */
	title?: string;
}

interface AgentUiActionParams {
	value?: unknown;
}

export function createAgentUiActionHandlers(
	onSubmit?: (value: unknown) => void | Promise<void>
): { submit: (params: AgentUiActionParams) => Promise<void> } {
	return {
		submit: async (params) => {
			if (onSubmit && "value" in params) {
				await onSubmit(params.value);
			}
		},
	};
}

interface RawSpecFallbackProps {
	reason: string;
	spec: unknown;
}

function RawSpecFallback({ reason, spec }: RawSpecFallbackProps) {
	let json: string;
	try {
		json = JSON.stringify(spec, null, 2);
	} catch {
		json = String(spec);
	}
	return (
		<div className="rounded-[var(--radius)] border border-border bg-muted/40 p-3">
			<p className="mb-1.5 font-medium text-muted-foreground text-xs">
				{reason}
			</p>
			<pre className="max-h-64 overflow-auto text-foreground/70 text-xs">
				<code>{json}</code>
			</pre>
		</div>
	);
}

interface BoundaryProps {
	children: ReactNode;
	fallback: ReactNode;
}
interface BoundaryState {
	hasError: boolean;
}

// React error boundaries have no functional equivalent, so a class is required here.
// biome-ignore lint/style/useReactFunctionComponents: error boundaries must be class components
class RenderErrorBoundary extends Component<BoundaryProps, BoundaryState> {
	constructor(props: BoundaryProps) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(): BoundaryState {
		return { hasError: true };
	}

	render() {
		if (this.state.hasError) {
			return this.props.fallback;
		}
		return this.props.children;
	}
}

export function AgentUI({ spec, title, className, onSubmit }: AgentUIProps) {
	const submit = onSubmit;
	const [pending, setPending] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const handleSubmit = useCallback(
		async (value: unknown) => {
			if (!submit || pending || submitted) {
				return;
			}
			setPending(true);
			setSubmitError(null);
			try {
				await submit(value);
				setSubmitted(true);
			} catch (error) {
				setSubmitError(
					error instanceof Error ? error.message : "Submission failed"
				);
				throw error;
			} finally {
				setPending(false);
			}
		},
		[pending, submit, submitted]
	);
	if (!isRenderableSpec(spec)) {
		return (
			<RawSpecFallback
				reason="This UI spec couldn't be rendered."
				spec={spec}
			/>
		);
	}

	return (
		<div className={cn("agent-ui flex flex-col gap-2", className)}>
			{title && (
				<h3 className="font-medium text-foreground/80 text-xs">{title}</h3>
			)}
			<RenderErrorBoundary
				fallback={
					<RawSpecFallback reason="This UI failed to render." spec={spec} />
				}
			>
				<AgentUiSubmissionStateProvider state={{ pending, submitted }}>
					<StateProvider>
						<ActionProvider
							handlers={createAgentUiActionHandlers(handleSubmit)}
						>
							<JSONUIProvider registry={registry}>
								<Renderer
									fallback={UnknownComponent}
									registry={registry}
									spec={spec}
								/>
							</JSONUIProvider>
						</ActionProvider>
					</StateProvider>
				</AgentUiSubmissionStateProvider>
			</RenderErrorBoundary>
			{submitError ? (
				<p aria-live="polite" className="text-destructive text-xs" role="alert">
					{submitError}
				</p>
			) : pending ? (
				<p
					aria-live="polite"
					className="text-muted-foreground text-xs"
					role="status"
				>
					Submitting…
				</p>
			) : submitted ? (
				<p
					aria-live="polite"
					className="text-muted-foreground text-xs"
					role="status"
				>
					Submitted
				</p>
			) : null}
		</div>
	);
}
