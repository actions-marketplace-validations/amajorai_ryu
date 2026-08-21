export type TargetMode = "auto" | "self-hosted" | "managed";

export type Operation = "setup" | "run" | "tool";

export interface ActionInputs {
	agent: string | null;
	conversationId: string | null;
	cwd: string | null;
	enableLongTerm: boolean;
	exportEnv: boolean;
	inference: Record<string, unknown> | null;
	managedNodeToken: string | null;
	managedNodeUrl: string | null;
	nodeToken: string | null;
	nodeUrl: string | null;
	operation: Operation;
	persist: boolean;
	pluginFlags: Record<string, boolean> | null;
	prompt: string | null;
	responseFile: string | null;
	target: TargetMode;
	team: string | null;
	timeoutMs: number;
	tool: string | null;
	toolArguments: unknown;
	userId: string | null;
	workflow: string | null;
	worktreeIsolation: boolean;
	writeSummary: boolean;
}

export interface ResolvedTarget {
	mode: TargetMode;
	token: string | null;
	url: string;
}

export interface NodeHealth {
	capabilities: unknown[];
	channel: string | null;
	status: string;
	version: string | null;
}

export interface NodeInfo {
	hostname: string | null;
	managed: boolean;
	orgId: string | null;
	orgName: string | null;
	os: string | null;
	[key: string]: unknown;
}

export interface NodeSnapshot {
	health: NodeHealth;
	info: NodeInfo;
	mode: TargetMode;
	url: string;
}

export interface ToolEvent {
	input?: unknown;
	output?: unknown;
	status?: string | null;
	toolCallId: string | null;
	toolName: string | null;
	type: "input" | "output";
}

export interface ChatResult {
	conversationId: string;
	finished: boolean;
	runId: string | null;
	text: string;
	toolEvents: ToolEvent[];
	workflowEvents: unknown[];
}

export interface ToolResult {
	error: string | null;
	ok: boolean;
	output: unknown;
}

export interface ActionResult {
	conversationId: string | null;
	node: NodeSnapshot;
	operation: Operation;
	result: ChatResult | ToolResult | null;
	runId: string | null;
	text: string;
	toolEvents: ToolEvent[];
}

export interface ChatRequest {
	acp_config?: Record<string, string>;
	acp_mode?: string;
	acp_model?: string;
	agent_id?: string;
	conversation_id: string;
	cwd?: string;
	enable_long_term: boolean;
	inference?: Record<string, unknown>;
	messages: Array<{
		content: Array<{ text: string; type: "text" }>;
		role: "user";
	}>;
	persist: boolean;
	plugin_flags?: Record<string, boolean>;
	team_id?: string;
	workflow_id?: string;
	worktree_isolation?: boolean;
}

export interface ToolRequest {
	agent_id: string;
	arguments: unknown;
	tool: string;
	user_id?: string;
}
