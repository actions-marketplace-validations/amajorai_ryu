// The `ryu` subcommand registry: a flat list of {@link Command}s, each mapping to
// an existing Core endpoint via the injected {@link CoreApi}. A registry (name →
// handler) is deliberately used over a big switch so app-contributed subcommands
// can later extend it (see the extension seam in dispatch.ts).
//
// Endpoint map (all pre-existing Core lifecycle routes, wrapped by core-client):
//   list/ls           GET  /api/plugins                (fetchApps)
//   catalog/search    GET  /api/plugins/catalog        (fetchAppsCatalog)
//   add/install       POST /api/plugins/:id/install    (installApp)
//   enable            POST /api/plugins/:id/enable      (enableApp)
//   disable           POST /api/plugins/:id/disable     (disableApp)
//   uninstall/rm      POST /api/plugins/:id/uninstall   (uninstallApp)
//   init              local  → bunx create-ryu-app      (ctx.scaffold)
//   chat              POST /api/chat/stream             (streamChat, SSE)
//   node ls/use       local ~/.ryu/nodes.json store     (loadNodes/setActive)
//   help / version    local
//
// Apps AND plugins: every lifecycle command above takes a plain id and works for
// both, because Core has ONE lifecycle API — `/api/plugins/:id/*` does not care
// whether the manifest ships a Companion UI. "app" vs "plugin" is a catalog
// classification (see kind.ts), so it shows up here only as the `--kind` filter
// and the KIND column, never as a second install path.

import {
	decryptSecrets,
	hasEncryptedSecrets,
	packageSummary,
	readPackageInput,
	redactPackageTree,
	validatePublishablePackage,
	writePackageArchive,
	writePackageFolder,
} from "@ryu/portable-packages";
import { loadNodes, resolveActive, setActive } from "../core/nodes.ts";
import {
	catalogEntryKind,
	installedAppKind,
	kindFilterPlural,
	matchesKind,
	parseKindFilter,
} from "./kind.ts";
import { formatTable, truncate } from "./output.ts";
import { type CliContext, type Command, UsageError } from "./types.ts";
import { VERSION } from "./version.ts";

const DESCRIPTION_WIDTH = 50;

function packageArg(ctx: CliContext, index: number, usage: string): string {
	const value = ctx.args[index];
	if (!value) {
		throw new UsageError(`Usage: ${usage}`);
	}
	return value;
}

function packageOutput(ctx: CliContext, value: unknown, human: string): void {
	ctx.io.out(
		ctx.flags.json ? `${JSON.stringify(value, null, 2)}\n` : `${human}\n`
	);
}

async function packageUnlockKey(ctx: CliContext): Promise<string> {
	const key = process.env.RYU_PACKAGE_KEY?.trim();
	if (key) {
		return key;
	}
	if (!(process.stdin.isTTY && process.stdout.isTTY)) {
		throw new Error(
			"An encrypted package requires RYU_PACKAGE_KEY when stdin is not interactive."
		);
	}
	const { createInterface } = await import("node:readline/promises");
	const readline = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		const answer = await readline.question("Package unlock key: ");
		if (!answer.trim()) {
			throw new Error("A package unlock key is required");
		}
		return answer;
	} finally {
		readline.close();
	}
}

async function writePackageDestination(
	destination: string,
	tree: Awaited<ReturnType<typeof readPackageInput>>
): Promise<void> {
	if (destination.toLowerCase().endsWith(".ryupack")) {
		await writePackageArchive(destination, tree);
		return;
	}
	await writePackageFolder(destination, tree);
}

const packageCommand: Command = {
	name: "package",
	aliases: ["pkg"],
	summary: "Validate, inspect, import, export, and pack portable packages",
	usage:
		"ryu package <validate|inspect|pack|unpack|import|export|publish> <path> [destination]",
	run: async (ctx) => {
		const action = ctx.args[0];
		const usage =
			"ryu package <validate|inspect|pack|unpack|import|export|publish> <path> [destination]";
		if (!action) {
			throw new UsageError(`Usage: ${usage}`);
		}
		if (action === "validate" || action === "inspect") {
			const input = packageArg(ctx, 1, usage);
			const tree = await readPackageInput(input);
			const summary = packageSummary(tree);
			packageOutput(
				ctx,
				summary,
				action === "validate"
					? `Valid package ${summary.id}@${summary.version} (${summary.kind}) · ${summary.files.length} files`
					: `${summary.id}@${summary.version}\n${summary.files.map((path) => `  ${path}`).join("\n")}`
			);
			return 0;
		}
		if (action === "pack") {
			const input = packageArg(ctx, 1, usage);
			const destination = ctx.args[2] ?? `${input.replace(/\/$/, "")}.ryupack`;
			const tree = await readPackageInput(input);
			await writePackageDestination(destination, tree);
			packageOutput(
				ctx,
				{ destination, ...packageSummary(tree) },
				`Packed ${destination}`
			);
			return 0;
		}
		if (action === "unpack" || action === "import") {
			const input = packageArg(ctx, 1, usage);
			const destination = packageArg(ctx, 2, usage);
			const tree = await readPackageInput(input);
			if (action === "import" && hasEncryptedSecrets(tree)) {
				decryptSecrets(
					tree.files["secrets.enc"]!,
					await packageUnlockKey(ctx),
					tree.manifest
				);
			}
			await writePackageDestination(destination, tree);
			packageOutput(
				ctx,
				{ destination, ...packageSummary(tree) },
				`Imported ${tree.manifest.id} into ${destination}`
			);
			return 0;
		}
		if (action === "export") {
			const input = packageArg(ctx, 1, usage);
			const destination = packageArg(ctx, 2, usage);
			const tree = await readPackageInput(input);
			if (!ctx.flags.includeSecrets) {
				const redacted = redactPackageTree(tree);
				await writePackageDestination(destination, redacted);
				packageOutput(
					ctx,
					{ destination, redacted: true, ...packageSummary(redacted) },
					`Exported redacted package to ${destination}`
				);
				return 0;
			}
			if (!hasEncryptedSecrets(tree)) {
				throw new Error(
					"--include-secrets requires a package that already contains an encrypted secrets.enc envelope"
				);
			}
			decryptSecrets(
				tree.files["secrets.enc"]!,
				await packageUnlockKey(ctx),
				tree.manifest
			);
			await writePackageDestination(destination, tree);
			packageOutput(
				ctx,
				{ destination, redacted: false, ...packageSummary(tree) },
				`Exported package to ${destination}`
			);
			return 0;
		}
		if (action === "publish") {
			const input = packageArg(ctx, 1, usage);
			const tree = await readPackageInput(input);
			validatePublishablePackage(tree);
			packageOutput(
				ctx,
				{ publishable: true, ...packageSummary(tree) },
				`Package ${tree.manifest.id}@${tree.manifest.version} is publishable`
			);
			return 0;
		}
		throw new UsageError(`Usage: ${usage}`);
	},
};

async function callCore(
	ctx: CliContext,
	path: string,
	options: { method?: string; body?: unknown } = {}
): Promise<unknown> {
	if (!ctx.api.call) {
		throw new Error("This command requires the live Core client.");
	}
	return ctx.api.call(ctx.target, path, {
		method: options.method ?? "POST",
		body: options.body,
	});
}

/** `ryu action <id> <json> --agent <agent-id>` — invoke one canonical Action
 * through Core. The explicit agent is required because Core's node token
 * authenticates the node, not the calling agent; omitting it would make the
 * allowlist/approval principal ambiguous. */
const actionCommand: Command = {
	name: "action",
	summary: "Call one governed Action through Core",
	usage: "ryu action <id> <json> --agent <agent-id>",
	run: async (ctx) => {
		const actionId = ctx.args[0];
		if (!(actionId && ctx.flags.agent)) {
			throw new UsageError("Usage: ryu action <id> <json> --agent <agent-id>");
		}
		const rawArguments = ctx.args[1] ?? "{}";
		let argumentsValue: unknown;
		try {
			argumentsValue = JSON.parse(rawArguments) as unknown;
		} catch {
			throw new UsageError("Action arguments must be valid JSON.");
		}

		const result = ctx.api.callAction
			? await ctx.api.callAction(ctx.target, actionId, {
					agentId: ctx.flags.agent,
					arguments: argumentsValue,
				})
			: await callCore(ctx, `/api/actions/${encodeURIComponent(actionId)}`, {
					method: "POST",
					body: {
						agent_id: ctx.flags.agent,
						arguments: argumentsValue,
					},
				});

		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify(result, null, 2)}\n`);
		} else if (
			typeof result === "object" &&
			result !== null &&
			"ok" in result &&
			(result as { ok?: unknown }).ok === false
		) {
			ctx.io.out(
				`Action ${actionId} failed: ${String((result as { error?: unknown }).error ?? "unknown error")}\n`
			);
		} else {
			ctx.io.out(`Action ${actionId} completed.\n`);
		}
		return typeof result === "object" &&
			result !== null &&
			"ok" in result &&
			(result as { ok?: unknown }).ok === false
			? 1
			: 0;
	},
};

function rawCommand(
	name: string,
	usage: string,
	summary: string,
	path: string,
	method: string,
	argsToBody = false
): Command {
	return {
		name,
		summary,
		usage,
		run: async (ctx) => {
			const body = argsToBody ? { args: ctx.args } : undefined;
			const result = await callCore(ctx, path, { method, body });
			ctx.io.out(
				`${ctx.flags.json ? JSON.stringify(result, null, 2) : JSON.stringify(result)}\n`
			);
			return 0;
		},
	};
}

const updateCommand = rawCommand(
	"update",
	"ryu update",
	"Check for an available Ryu update",
	"/api/update/check",
	"GET"
);
function catalogLifecycleCommand(
	name: string,
	usage: string,
	summary: string,
	catalogPath: string,
	installPath: (id: string) => string,
	extraBody?: Record<string, unknown>
): Command {
	return {
		name,
		summary,
		usage,
		run: async (ctx) => {
			const sub = ctx.args[0] ?? "list";
			if (sub === "list") {
				const result = await ctx.api.call?.(ctx.target, catalogPath, {
					method: "GET",
				});
				ctx.io.out(
					`${ctx.flags.json ? JSON.stringify(result, null, 2) : JSON.stringify(result)}\n`
				);
				return 0;
			}
			if (sub !== "add" && sub !== "install") {
				throw new UsageError(`Usage: ${usage}`);
			}
			const id = ctx.args[1];
			if (!id) {
				throw new UsageError(`Usage: ${usage}`);
			}
			const result = await callCore(ctx, installPath(id), {
				method: "POST",
				body: { id, ...extraBody },
			});
			ctx.io.out(
				`${ctx.flags.json ? JSON.stringify(result, null, 2) : `Installed ${id}.`}\n`
			);
			return 0;
		},
	};
}

const modelsCommand = catalogLifecycleCommand(
	"models",
	"ryu models <list|add> [id]",
	"Browse or install models",
	"/api/models/catalog",
	() => "/api/models/catalog/install",
	{ format: "gguf" }
);
const skillsCommand = catalogLifecycleCommand(
	"skills",
	"ryu skills <list|add> [id]",
	"Browse or install skills",
	"/api/skills/catalog",
	() => "/api/skills/catalog/install"
);
const appsCommand = catalogLifecycleCommand(
	"apps",
	"ryu apps <list|add> [id]",
	"List or install apps",
	"/api/plugins",
	(id) => `/api/plugins/${encodeURIComponent(id)}/install`
);
const mcpCommand = catalogLifecycleCommand(
	"mcp",
	"ryu mcp <list|add> [id]",
	"Browse or install MCP servers",
	"/api/mcp/catalog",
	() => "/api/mcp/catalog/install"
);
const okfCommand = rawCommand(
	"okf",
	"ryu okf export <dir>",
	"Export an OKF knowledge bundle",
	"/api/okf/export",
	"POST",
	true
);
const stackCommand = rawCommand(
	"stack",
	"ryu stack <export|import> [file]",
	"Export or import a fleet stack",
	"/api/fleet/stack/export",
	"GET"
);
const applyCommand = rawCommand(
	"apply",
	"ryu apply -f <file>",
	"Apply gateway configuration",
	"/api/gateway/config",
	"PUT",
	true
);
const diffCommand = rawCommand(
	"diff",
	"ryu diff -f <file>",
	"Preview gateway configuration changes",
	"/api/gateway/config",
	"GET"
);
const configCommand = rawCommand(
	"config",
	"ryu config <show|revisions|rollback>",
	"Inspect gateway configuration",
	"/api/gateway/config",
	"GET"
);
const sessionsCommand = rawCommand(
	"sessions",
	"ryu sessions",
	"List active sessions",
	"/api/sessions",
	"GET"
);
const whoamiCommand = rawCommand(
	"whoami",
	"ryu whoami",
	"Show the signed-in account",
	"/api/auth/session",
	"GET"
);
const planCommand = rawCommand(
	"plan",
	"ryu plan",
	"Show subscription status",
	"/api/account/plan",
	"GET"
);
const accountCommand = rawCommand(
	"account",
	"ryu account",
	"Show account details",
	"/api/account",
	"GET"
);
const loginCommand = rawCommand(
	"login",
	"ryu login",
	"Open the account login flow",
	"/api/auth/sign-in",
	"POST",
	true
);
const logoutCommand = rawCommand(
	"logout",
	"ryu logout",
	"Sign out of the account",
	"/api/auth/sign-out",
	"POST"
);
const setupCommand = rawCommand(
	"setup",
	"ryu setup",
	"Inspect dependency setup",
	"/api/setup/status",
	"GET"
);

interface DoctorFindingView {
	canAutoFix: boolean;
	category: string;
	checkId: string;
	detail: string;
	recommendedAction: string | null;
	settingPath: string | null;
	severity: string;
	summary: string;
}

interface DoctorReportView {
	counts: { errors: number; info: number; warnings: number };
	findings: DoctorFindingView[];
	posture: string;
}

interface DoctorFixView {
	action: string;
	checkId: string;
	settingPath: string;
	summary: string;
}

interface DoctorResponseView {
	appliedFixes: DoctorFixView[];
	dryRun: boolean;
	plannedFixes: DoctorFixView[];
	report: DoctorReportView;
}

function doctorRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Gateway Doctor returned an invalid ${label}.`);
	}
	return value as Record<string, unknown>;
}

function doctorString(
	record: Record<string, unknown>,
	key: string,
	defaultValue = ""
): string {
	return typeof record[key] === "string" ? record[key] : defaultValue;
}

function doctorCount(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseDoctorFinding(value: unknown): DoctorFindingView {
	const record = doctorRecord(value, "finding");
	return {
		canAutoFix: record.canAutoFix === true,
		category: doctorString(record, "category", "unknown"),
		checkId: doctorString(record, "checkId", "unknown"),
		detail: doctorString(record, "detail"),
		recommendedAction:
			typeof record.recommendedAction === "string"
				? record.recommendedAction
				: null,
		settingPath:
			typeof record.settingPath === "string" ? record.settingPath : null,
		severity: doctorString(record, "severity", "info"),
		summary: doctorString(record, "summary", "Unknown finding"),
	};
}

function parseDoctorReport(value: unknown): DoctorReportView {
	const record = doctorRecord(value, "report");
	const counts = doctorRecord(record.counts, "counts");
	if (!Array.isArray(record.findings)) {
		throw new Error("Gateway Doctor returned no findings.");
	}
	return {
		counts: {
			errors: doctorCount(counts, "errors"),
			info: doctorCount(counts, "info"),
			warnings: doctorCount(counts, "warnings"),
		},
		findings: record.findings.map(parseDoctorFinding),
		posture: doctorString(record, "posture", "unknown"),
	};
}

function parseDoctorFix(value: unknown): DoctorFixView {
	const record = doctorRecord(value, "fix");
	return {
		action: doctorString(record, "action"),
		checkId: doctorString(record, "checkId", "unknown"),
		settingPath: doctorString(record, "settingPath", "unknown"),
		summary: doctorString(record, "summary", "Unknown fix"),
	};
}

function parseDoctorResponse(value: unknown): DoctorResponseView {
	const record = doctorRecord(value, "response");
	const planned = Array.isArray(record.plannedFixes)
		? record.plannedFixes.map(parseDoctorFix)
		: [];
	const applied = Array.isArray(record.appliedFixes)
		? record.appliedFixes.map(parseDoctorFix)
		: [];
	const report = parseDoctorReport(record.report ?? record);
	return {
		appliedFixes: applied,
		dryRun: record.dryRun === true,
		plannedFixes: planned,
		report,
	};
}

function renderDoctorResponse(result: DoctorResponseView): string {
	const { counts } = result.report;
	const lines = [
		`Gateway Doctor · posture ${result.report.posture}`,
		`${counts.errors} error${counts.errors === 1 ? "" : "s"} · ${counts.warnings} warning${counts.warnings === 1 ? "" : "s"} · ${counts.info} info`,
		"",
	];

	if (result.report.findings.length === 0) {
		lines.push(
			"Healthy — no configuration, security, or performance issues found."
		);
	} else {
		for (const finding of result.report.findings) {
			lines.push(
				`[${finding.severity}] ${finding.category} · ${finding.summary}`,
				`  ${finding.detail}`
			);
			if (finding.settingPath) {
				lines.push(`  setting: ${finding.settingPath}`);
			}
			if (finding.recommendedAction) {
				lines.push(`  action: ${finding.recommendedAction}`);
			}
			lines.push("");
		}
	}

	if (result.plannedFixes.length > 0) {
		lines.push(
			result.dryRun
				? `Safe fixes available (dry run — nothing changed): ${result.plannedFixes.length}`
				: `Safe fixes planned: ${result.plannedFixes.length}`
		);
		for (const fix of result.plannedFixes) {
			lines.push(`  - ${fix.settingPath}: ${fix.action}`);
		}
		if (result.appliedFixes.length > 0) {
			lines.push(
				`Applied: ${result.appliedFixes.length} safe fix${result.appliedFixes.length === 1 ? "" : "es"}.`
			);
		}
	} else if (result.report.findings.some((finding) => finding.canAutoFix)) {
		lines.push(
			"Safe fixes are available; run `ryu doctor --dry-run` to preview them."
		);
	}

	return `${lines.join("\n").trimEnd()}\n`;
}

const doctorCommand: Command = {
	name: "doctor",
	summary: "Audit Gateway configuration and security",
	usage: "ryu doctor [--fix] [--dry-run] [--json]",
	run: async (ctx) => {
		const previewOrFix = ctx.flags.fix || ctx.flags.dryRun;
		const raw = await callCore(
			ctx,
			previewOrFix ? "/api/gateway/doctor/fix" : "/api/gateway/doctor",
			previewOrFix
				? { method: "POST", body: { dryRun: ctx.flags.dryRun } }
				: { method: "GET" }
		);
		const result = parseDoctorResponse(raw);
		ctx.io.out(
			ctx.flags.json
				? `${JSON.stringify(raw, null, 2)}\n`
				: renderDoctorResponse(result)
		);
		return result.report.counts.errors > 0 ? 1 : 0;
	},
};

interface PluginDoctorFindingView {
	category: string;
	checkId: string;
	detail: string;
	pluginId: string;
	recommendedAction: string;
	severity: string;
	summary: string;
}

interface PluginDoctorResponseView {
	counts: { errors: number; info: number; plugins: number; warnings: number };
	findings: PluginDoctorFindingView[];
	plugins: {
		findingCount: number;
		id: string;
		name: string;
		status: string;
	}[];
	score: number;
}

function parsePluginDoctorFinding(value: unknown): PluginDoctorFindingView {
	const record = doctorRecord(value, "plugin doctor finding");
	return {
		category: doctorString(record, "category", "unknown"),
		checkId: doctorString(record, "checkId", "unknown"),
		detail: doctorString(record, "detail"),
		pluginId: doctorString(record, "pluginId", "unknown"),
		recommendedAction: doctorString(record, "recommendedAction"),
		severity: doctorString(record, "severity", "info"),
		summary: doctorString(record, "summary", "Unknown finding"),
	};
}

function parsePluginDoctorResponse(value: unknown): PluginDoctorResponseView {
	const record = doctorRecord(value, "plugin doctor response");
	const counts = doctorRecord(record.counts, "plugin doctor counts");
	const plugins = Array.isArray(record.plugins) ? record.plugins : [];
	const findings = Array.isArray(record.findings)
		? record.findings.map(parsePluginDoctorFinding)
		: [];
	return {
		counts: {
			errors: doctorCount(counts, "errors"),
			info: doctorCount(counts, "info"),
			plugins: doctorCount(counts, "plugins"),
			warnings: doctorCount(counts, "warnings"),
		},
		findings,
		plugins: plugins.map((value) => {
			const plugin = doctorRecord(value, "plugin doctor inventory");
			return {
				findingCount: doctorCount(plugin, "findingCount"),
				id: doctorString(plugin, "id", "unknown"),
				name: doctorString(plugin, "name", "Unknown plugin"),
				status: doctorString(plugin, "status", "unknown"),
			};
		}),
		score:
			typeof record.score === "number" && Number.isFinite(record.score)
				? record.score
				: 0,
	};
}

function renderPluginDoctorResponse(result: PluginDoctorResponseView): string {
	const lines = [
		`Plugin Doctor · ${result.score}/100 · ${result.counts.plugins} artifact${result.counts.plugins === 1 ? "" : "s"}`,
		`${result.counts.errors} error${result.counts.errors === 1 ? "" : "s"} · ${result.counts.warnings} warning${result.counts.warnings === 1 ? "" : "s"}`,
		"Read-only lint: Core validated the loaded manifest and lifecycle state; it did not execute plugin code or start sidecars.",
		"",
	];
	if (result.plugins.length > 0) {
		for (const plugin of result.plugins) {
			lines.push(
				`${plugin.status.padEnd(7)} ${plugin.id} · ${plugin.name}`,
				plugin.findingCount > 0
					? `  ${plugin.findingCount} finding${plugin.findingCount === 1 ? "" : "s"}`
					: "  no findings"
			);
		}
		lines.push("");
	}
	if (result.findings.length === 0) {
		lines.push(
			"Healthy — no manifest, lifecycle, dependency, or permission drift found."
		);
	} else {
		for (const finding of result.findings) {
			lines.push(
				`[${finding.severity}] ${finding.pluginId} · ${finding.summary}`,
				`  ${finding.detail}`,
				`  action: ${finding.recommendedAction}`,
				`  check: ${finding.checkId}`,
				""
			);
		}
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

const pluginDoctorCommand: Command = {
	aliases: ["app"],
	name: "plugin",
	summary: "Validate an installed plugin or app",
	usage: "ryu plugin doctor [id] [--json]",
	run: async (ctx) => {
		if (ctx.args[0] !== "doctor" || ctx.args.length > 2) {
			throw new UsageError("Usage: ryu plugin doctor [id] [--json]");
		}
		const id = ctx.args[1];
		const path = id
			? `/api/plugins/doctor?id=${encodeURIComponent(id)}`
			: "/api/plugins/doctor";
		const raw = await callCore(ctx, path, { method: "GET" });
		const result = parsePluginDoctorResponse(raw);
		ctx.io.out(
			ctx.flags.json
				? `${JSON.stringify(raw, null, 2)}\n`
				: renderPluginDoctorResponse(result)
		);
		return result.counts.errors > 0 ? 1 : 0;
	},
};

const openCommand = rawCommand(
	"open",
	"ryu open <page>",
	"Open a Ryu deep-link target",
	"/api/deep-link",
	"POST",
	true
);
openCommand.aliases = ["link"];

const statusCommand: Command = {
	name: "status",
	summary: "Show Core and sidecar status",
	usage: "ryu status [--json]",
	run: async (ctx) => {
		const data = await ctx.api.call?.(ctx.target, "/api/system/status");
		if (data === undefined) {
			throw new Error("This command requires the live Core client.");
		}
		ctx.io.out(
			`${ctx.flags.json ? JSON.stringify(data, null, 2) : JSON.stringify(data)}\n`
		);
		return 0;
	},
};

function sidecarCommand(name: "start" | "stop" | "restart"): Command {
	return {
		name,
		summary: `${name[0].toUpperCase()}${name.slice(1)} a sidecar`,
		usage: `ryu ${name} <name|all>`,
		run: async (ctx) => {
			const target = ctx.args[0] ?? (name === "restart" ? null : "all");
			if (!target) {
				throw new UsageError(`Usage: ryu ${name} <name>`);
			}
			const path =
				target === "all"
					? `/api/sidecar/${name}-all`
					: `/api/sidecar/${target}/${name}`;
			await callCore(ctx, path);
			ctx.io.out(`${name[0].toUpperCase()}${name.slice(1)}d ${target}.\n`);
			return 0;
		},
	};
}

/** Read the first positional arg or throw a usage error naming the correct form. */
function requireArg(ctx: CliContext, name: string, usage: string): string {
	const value = ctx.args[0];
	if (!value) {
		throw new UsageError(`Missing ${name}. Usage: ${usage}`);
	}
	return value;
}

/** `ryu list` / `ryu ls` — installed apps and plugins (id, name, kind, enabled).
 *  `--kind` narrows to one classification; unset = both, which is the pre-flag
 *  behavior and so cannot break a script that predates it. `--json` keeps emitting
 *  the raw AppInfo records (filtered, never reshaped) — a consumer that wants the
 *  classification derives it from `runnables` exactly as the KIND column does. */
const listCommand: Command = {
	name: "list",
	aliases: ["ls"],
	summary: "List installed apps and plugins",
	usage: "ryu list [--kind app|plugin|all] [--json]",
	run: async (ctx) => {
		const filter = parseKindFilter(ctx.flags.kind);
		const apps = await ctx.api.fetchApps(ctx.target);
		const installed = apps.filter(
			(a) =>
				(a.installed || a.builtIn) && matchesKind(filter, installedAppKind(a))
		);
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify(installed, null, 2)}\n`);
			return 0;
		}
		if (installed.length === 0) {
			ctx.io.out(`No ${kindFilterPlural(filter)} installed.\n`);
			return 0;
		}
		const rows = installed.map((a) => [
			a.id,
			a.name,
			installedAppKind(a),
			a.enabled ? "yes" : "no",
		]);
		ctx.io.out(`${formatTable(["ID", "NAME", "KIND", "ENABLED"], rows)}\n`);
		return 0;
	},
};

/** `ryu catalog` / `ryu search [q]` — installable apps AND plugins from the remote
 *  registry. One Core endpoint returns both, so both have always been listed here;
 *  the KIND column is what finally makes them distinguishable, and `--kind` is the
 *  narrowing a scripted caller needs. */
const catalogCommand: Command = {
	name: "catalog",
	aliases: ["search"],
	summary: "Browse/search installable apps and plugins",
	usage: "ryu catalog [query] [--kind app|plugin|all] [--json]",
	run: async (ctx) => {
		const filter = parseKindFilter(ctx.flags.kind);
		const entries = await ctx.api.fetchAppsCatalog(ctx.target);
		const query = ctx.args[0]?.toLowerCase();
		const matches = entries
			.filter((e) => matchesKind(filter, catalogEntryKind(e)))
			.filter(
				(e) =>
					!query ||
					e.id.toLowerCase().includes(query) ||
					e.name.toLowerCase().includes(query) ||
					e.tags.some((t) => t.toLowerCase().includes(query))
			);
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify(matches, null, 2)}\n`);
			return 0;
		}
		if (matches.length === 0) {
			ctx.io.out(`No matching ${kindFilterPlural(filter)}.\n`);
			return 0;
		}
		const rows = matches.map((e) => [
			e.id,
			e.name,
			catalogEntryKind(e),
			e.version,
			truncate(e.description, DESCRIPTION_WIDTH),
		]);
		ctx.io.out(
			`${formatTable(["ID", "NAME", "KIND", "VERSION", "DESCRIPTION"], rows)}\n`
		);
		return 0;
	},
};

/** `ryu add <id>` / `ryu install <id>` — the shadcn-style install command. Takes
 *  the id of an app OR a plugin: `POST /api/plugins/:id/install` is the single
 *  lifecycle route for both, so there is nothing to branch on here. */
const addCommand: Command = {
	name: "add",
	aliases: ["install"],
	summary: "Install an app or plugin from the catalog",
	usage: "ryu add <id> [--json]",
	run: async (ctx) => {
		const id = requireArg(ctx, "app or plugin id", "ryu add <id>");
		const record = await ctx.api.installApp(ctx.target, id);
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify(record, null, 2)}\n`);
			return 0;
		}
		ctx.io.out(
			`Installed ${record.id}@${record.version} (disabled). Run 'ryu enable ${record.id}' to turn it on.\n`
		);
		return 0;
	},
};

/** `ryu enable <id>` — apps and plugins alike (one Core route for both). */
const enableCommand: Command = {
	name: "enable",
	summary: "Enable an installed app or plugin",
	usage: "ryu enable <id> [--json]",
	run: async (ctx) => {
		const id = requireArg(ctx, "app or plugin id", "ryu enable <id>");
		const record = await ctx.api.enableApp(ctx.target, id);
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify(record, null, 2)}\n`);
			return 0;
		}
		ctx.io.out(`Enabled ${record.id}.\n`);
		return 0;
	},
};

/** `ryu disable <id>` (`--cascade` to disable dependents too). */
const disableCommand: Command = {
	name: "disable",
	summary: "Disable an app or plugin",
	usage: "ryu disable <id> [--cascade] [--json]",
	run: async (ctx) => {
		const id = requireArg(ctx, "app or plugin id", "ryu disable <id>");
		const record = await ctx.api.disableApp(ctx.target, id, {
			cascade: ctx.flags.cascade,
		});
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify(record, null, 2)}\n`);
			return 0;
		}
		ctx.io.out(`Disabled ${record.id}.\n`);
		return 0;
	},
};

/** `ryu uninstall <id>` / `ryu rm <id>` (`--cascade` for dependents). */
const uninstallCommand: Command = {
	name: "uninstall",
	aliases: ["rm"],
	summary: "Uninstall an app or plugin",
	usage: "ryu uninstall <id> [--cascade] [--json]",
	run: async (ctx) => {
		const id = requireArg(ctx, "app or plugin id", "ryu uninstall <id>");
		const result = await ctx.api.uninstallApp(ctx.target, id, {
			cascade: ctx.flags.cascade,
		});
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify(result, null, 2)}\n`);
			return 0;
		}
		ctx.io.out(`Uninstalled ${result.removed}.\n`);
		if (result.notice) {
			ctx.io.out(`${result.notice}\n`);
		}
		return 0;
	},
};

/** `ryu init <name> [--template <t>]` — scaffold a new app or plugin project.
 *
 *  Templates are NOT reimplemented here. `create-ryu-app` is the source of truth
 *  for what an app/plugin skeleton looks like, and `ctx.scaffold` shells out to it
 *  exactly as a user would (`bunx create-ryu-app <name> [--template <t>]`). Two
 *  things that would look tempting are wrong: importing the package would give the
 *  tui a build-time dependency on a package it does not own AND freeze its template
 *  list into this binary; and validating `<name>`/`--template` here would duplicate
 *  the scaffolder's own gates, so a template added upstream would be rejected by a
 *  stale copy of the list. Both are deliberately left to the child, whose usage
 *  text is forwarded verbatim on failure. */
const initCommand: Command = {
	name: "init",
	summary: "Scaffold a new app or plugin project",
	usage: "ryu init <name> [--template <t>]",
	run: async (ctx) => {
		const name = requireArg(ctx, "project name", "ryu init <name>");
		const template = ctx.flags.template;
		const argv = template ? [name, "--template", template] : [name];
		const result = await ctx.scaffold(argv);
		const ok = result.exitCode === 0;
		if (ctx.flags.json) {
			ctx.io.out(
				`${JSON.stringify({
					name,
					template: template ?? null,
					exitCode: result.exitCode,
					stdout: result.stdout,
					stderr: result.stderr,
				})}\n`
			);
			return ok ? 0 : 1;
		}
		// The scaffolder prints its own "created …/ next steps:" block — forward it
		// rather than paraphrasing, so `ryu init` and `bunx create-ryu-app` never
		// tell a user two different things about the project they just made.
		if (result.stdout) {
			ctx.io.out(result.stdout);
		}
		if (result.stderr) {
			ctx.io.err(result.stderr);
		}
		return ok ? 0 : 1;
	},
};

/** `ryu chat "<msg>"` — one-shot chat: stream the assistant reply, then exit. */
const chatCommand: Command = {
	name: "chat",
	summary: "Send one message and print the reply",
	usage: 'ryu chat "<message>" [--json]',
	run: async (ctx) => {
		const message = ctx.args.join(" ").trim();
		if (!message) {
			throw new UsageError('Missing message. Usage: ryu chat "<message>"');
		}
		let collected = "";
		let streamError: string | null = null;
		await ctx.api.streamChat(
			ctx.target,
			[{ role: "user", content: message }],
			{},
			{
				onTextDelta: (delta) => {
					if (ctx.flags.json) {
						collected += delta;
					} else {
						ctx.io.out(delta);
					}
				},
				onError: (m) => {
					streamError = m;
				},
				onDone: () => {
					/* resolved by streamChat returning */
				},
			}
		);
		if (streamError) {
			throw new Error(streamError);
		}
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify({ text: collected })}\n`);
		} else {
			ctx.io.out("\n");
		}
		return 0;
	},
};

/** `ryu node ls` / `ryu node use <name|url>` — the local multi-node store. */
const nodeCommand: Command = {
	name: "node",
	summary: "List or switch the active Core node",
	usage: "ryu node <ls | use <name|url>> [--json]",
	run: async (ctx) => {
		const sub = ctx.args[0] ?? "ls";
		if (sub === "ls" || sub === "list") {
			const config = loadNodes();
			const active = resolveActive(config).name;
			if (ctx.flags.json) {
				ctx.io.out(
					`${JSON.stringify({ active, nodes: config.nodes }, null, 2)}\n`
				);
				return 0;
			}
			const rows = config.nodes.map((n) => [
				n.name === active ? "*" : "",
				n.name,
				n.url,
			]);
			ctx.io.out(`${formatTable(["", "NAME", "URL"], rows)}\n`);
			return 0;
		}
		if (sub === "use") {
			const ref = ctx.args[1];
			if (!ref) {
				throw new UsageError("Usage: ryu node use <name|url>");
			}
			const config = loadNodes();
			const match = config.nodes.find((n) => n.name === ref || n.url === ref);
			if (match) {
				setActive(match.name);
				ctx.io.out(`Active node set to ${match.name} (${match.url}).\n`);
				return 0;
			}
			// The node store keys on NAME, not arbitrary URLs — be honest about the
			// per-invocation escape hatch rather than silently inventing a node.
			const names = config.nodes.map((n) => n.name).join(", ");
			ctx.io.err(
				`No configured node named or matching '${ref}'. Configured: ${names}.\nTo target an arbitrary node for one command, use --node <url> or set RYU_CORE_URL.\n`
			);
			return 1;
		}
		throw new UsageError("Usage: ryu node <ls | use <name|url>>");
	},
};

/** `ryu version` / `ryu --version`. */
const versionCommand: Command = {
	name: "version",
	summary: "Print the ryu version",
	usage: "ryu version",
	run: async (ctx) => {
		if (ctx.flags.json) {
			ctx.io.out(`${JSON.stringify({ version: VERSION })}\n`);
		} else {
			ctx.io.out(`ryu ${VERSION}\n`);
		}
		return 0;
	},
};

/** All built-in commands, in help-display order. `help` is appended below so its
 *  handler can close over this same list. */
const BASE_COMMANDS: Command[] = [
	actionCommand,
	statusCommand,
	sidecarCommand("start"),
	sidecarCommand("stop"),
	sidecarCommand("restart"),
	updateCommand,
	modelsCommand,
	skillsCommand,
	appsCommand,
	mcpCommand,
	okfCommand,
	stackCommand,
	applyCommand,
	diffCommand,
	configCommand,
	sessionsCommand,
	whoamiCommand,
	planCommand,
	accountCommand,
	loginCommand,
	logoutCommand,
	setupCommand,
	doctorCommand,
	pluginDoctorCommand,
	packageCommand,
	openCommand,
	listCommand,
	catalogCommand,
	addCommand,
	enableCommand,
	disableCommand,
	uninstallCommand,
	initCommand,
	chatCommand,
	nodeCommand,
	versionCommand,
];

/** Build the `ryu help` text from the registry so it never drifts from reality. */
export function renderHelp(): string {
	const lines: string[] = [
		"ryu — interactive TUI + scriptable CLI for a Ryu Core node.",
		"",
		"Usage:",
		"  ryu               Open the interactive TUI (same as 'ryu tui')",
		"  ryu <command> …   Run a one-shot command",
		"",
		"Commands:",
	];
	const all = [...BASE_COMMANDS, helpCommand];
	const appLine = "ryu <app> <cmd>";
	const width = Math.max(...all.map((c) => c.usage.length), appLine.length);
	for (const cmd of all) {
		lines.push(`  ${cmd.usage.padEnd(width)}  ${cmd.summary}`);
	}
	// App-contributed subcommands (surfaces.cli.commands) — resolved at runtime
	// against the active node; run `ryu <app>` to list what an app contributes.
	lines.push(
		`  ${appLine.padEnd(width)}  Run a command an installed app/plugin contributes`
	);
	lines.push(
		"",
		"Global flags:",
		"  --agent <id>    Calling agent for 'ryu action' (required)",
		"  --json          Machine-readable output (for agents/CI)",
		"  --node <url>    Target a specific Core node for this invocation",
		"  --kind <k>      Filter list/catalog: app | plugin | all (default: all)",
		"  --template <t>  Template for 'ryu init' (passed to create-ryu-app)",
		"  --force         Override a refused operation where supported",
		"  --cascade       Include dependents on disable/uninstall",
		"  --fix           Apply safe fixes for commands that support them",
		"  --dry-run       Preview safe fixes without writing changes",
		"  --include-secrets  Include an encrypted local secrets envelope when exporting",
		"  -h, --help      Show this help",
		"  --version       Print the version",
		"",
		"Examples:",
		"  ryu doctor",
		"  ryu doctor --dry-run",
		"  ryu doctor --fix",
		"  ryu doctor --fix --dry-run --json",
		"",
		"Apps vs plugins: both install, enable, disable and uninstall by id through the",
		"same commands — an app is a plugin that also ships a full-page UI. Use --kind",
		"to browse one at a time.",
		"",
		"Node targeting: RYU_CORE_URL / RYU_CORE_TOKEN (env) or --node <url>."
	);
	return lines.join("\n");
}

/** `ryu help` / `ryu -h` / `ryu --help`. */
const helpCommand: Command = {
	name: "help",
	summary: "Show this help",
	usage: "ryu help",
	run: async (ctx) => {
		ctx.io.out(`${renderHelp()}\n`);
		return 0;
	},
};

/** The complete registry, including `help`. */
export const COMMANDS: Command[] = [...BASE_COMMANDS, helpCommand];

/** Resolve a subcommand token to its {@link Command}, honoring aliases. */
export function findCommand(name: string): Command | undefined {
	return COMMANDS.find(
		(c) => c.name === name || (c.aliases?.includes(name) ?? false)
	);
}
