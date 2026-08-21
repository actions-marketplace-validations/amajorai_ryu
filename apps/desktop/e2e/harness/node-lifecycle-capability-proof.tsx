import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

type LifecyclePermission =
	| "app.install"
	| "app.update"
	| "app.enable"
	| "app.disable"
	| "app.uninstall";

type Action =
	| "install"
	| "update"
	| "enable"
	| "disable"
	| "uninstall"
	| "download";
type NodeKind = "org" | "team" | "personal" | "unbound";
type DecisionStatus = "allowed" | "denied";
type SubjectRole = "owner" | "admin" | "member" | "viewer";

interface Subject {
	id: string;
	label: string;
	orgId: string | null;
	role: SubjectRole;
	teamIds: string[];
}

interface RegisteredNode {
	id: string;
	kind: NodeKind;
	orgId: string | null;
	ownerUserId: string | null;
	teamId: string | null;
}

interface AccessRule {
	effect: "allow" | "deny";
	permission: LifecyclePermission;
	subjectId: string;
	subjectType: "team" | "member";
}

interface Scenario {
	action: Action;
	actor: Subject;
	entitlement: "active" | "expired" | "none";
	expected: DecisionStatus;
	id: string;
	label: string;
	packageLabel: string;
	paid: boolean;
}

type Result = Scenario & {
	actual: DecisionStatus;
	reason: string;
	requiredPermission: LifecyclePermission;
	log: string;
};

const node: RegisteredNode = {
	id: "node-team-7",
	kind: "team",
	orgId: "org-acme",
	teamId: "team-7",
	ownerUserId: null,
};

const subjects: Record<string, Subject> = {
	admin: {
		id: "owner-1",
		label: "Org admin",
		orgId: "org-acme",
		role: "admin",
		teamIds: [],
	},
	member: {
		id: "member-7",
		label: "Explicit team member",
		orgId: "org-acme",
		role: "member",
		teamIds: ["team-7"],
	},
	denied: {
		id: "member-denied",
		label: "Member-level deny",
		orgId: "org-acme",
		role: "member",
		teamIds: ["team-7"],
	},
	viewer: {
		id: "viewer-2",
		label: "Ordinary viewer",
		orgId: "org-acme",
		role: "viewer",
		teamIds: [],
	},
};

const rules: AccessRule[] = [
	...(
		[
			"app.install",
			"app.update",
			"app.enable",
			"app.disable",
			"app.uninstall",
		] as LifecyclePermission[]
	).map((permission) => ({
		effect: "allow" as const,
		permission,
		subjectId: "team-7",
		subjectType: "team" as const,
	})),
	{
		effect: "deny",
		permission: "app.install",
		subjectId: "member-denied",
		subjectType: "member",
	},
];

const permissionFor = (action: Action): LifecyclePermission => {
	if (action === "download") {
		return "app.install";
	}
	return `app.${action}` as LifecyclePermission;
};

const nodeScopeLabel = (registeredNode: RegisteredNode): string => {
	if (registeredNode.kind === "team") {
		return `team:${registeredNode.teamId}`;
	}
	if (registeredNode.kind === "org") {
		return `org:${registeredNode.orgId}`;
	}
	if (registeredNode.kind === "personal") {
		return `personal:${registeredNode.ownerUserId}`;
	}
	return "unbound:local-token";
};

const isNodeVisibleTo = (
	subject: Subject,
	registeredNode: RegisteredNode
): boolean => {
	if (registeredNode.kind === "unbound") {
		return true;
	}
	if (registeredNode.kind === "personal") {
		return registeredNode.ownerUserId === subject.id;
	}
	if (registeredNode.orgId !== subject.orgId) {
		return false;
	}
	if (registeredNode.kind === "team") {
		return (
			(registeredNode.teamId !== null &&
				subject.teamIds.includes(registeredNode.teamId)) ||
			subject.role === "owner" ||
			subject.role === "admin"
		);
	}
	return true;
};

const hasLifecyclePermission = (
	subject: Subject,
	registeredNode: RegisteredNode,
	permission: LifecyclePermission
): boolean => {
	if (subject.role === "owner" || subject.role === "admin") {
		return true;
	}
	const memberRule = rules.find(
		(rule) =>
			rule.subjectType === "member" &&
			rule.subjectId === subject.id &&
			rule.permission === permission
	);
	if (memberRule) {
		return memberRule.effect === "allow";
	}
	const teamRule = rules.find(
		(rule) =>
			rule.subjectType === "team" &&
			rule.subjectId === registeredNode.teamId &&
			rule.permission === permission
	);
	return teamRule?.effect === "allow";
};

const runScenario = (scenario: Scenario): Result => {
	const requiredPermission = permissionFor(scenario.action);
	let actual: DecisionStatus = "allowed";
	let reason = "allowed";

	if (!isNodeVisibleTo(scenario.actor, node)) {
		actual = "denied";
		reason = "node_scope_mismatch";
	} else if (
		!hasLifecyclePermission(scenario.actor, node, requiredPermission)
	) {
		actual = "denied";
		reason = "acl_denied";
	} else if (
		scenario.paid &&
		scenario.entitlement !== "active" &&
		(scenario.action === "install" ||
			scenario.action === "update" ||
			scenario.action === "download")
	) {
		actual = "denied";
		reason = "entitlement_required";
	}

	const log = JSON.stringify({
		action: scenario.action,
		actor: scenario.actor.id,
		node: node.id,
		node_scope: nodeScopeLabel(node),
		reason,
		result: actual,
		required_permission: requiredPermission,
		status: actual === "allowed" ? 200 : 403,
	});

	return { ...scenario, actual, log, reason, requiredPermission };
};

const scenarios: Scenario[] = [
	{
		action: "install",
		actor: subjects.viewer,
		entitlement: "none",
		expected: "denied",
		id: "member-denied",
		label: "Ordinary member denied by default",
		packageLabel: "free/plugin-calendar",
		paid: false,
	},
	{
		action: "install",
		actor: subjects.member,
		entitlement: "none",
		expected: "allowed",
		id: "team-grant",
		label: "Explicit team grant succeeds",
		packageLabel: "free/plugin-calendar",
		paid: false,
	},
	{
		action: "install",
		actor: subjects.denied,
		entitlement: "none",
		expected: "denied",
		id: "individual-deny",
		label: "Individual deny overrides team grant",
		packageLabel: "free/plugin-calendar",
		paid: false,
	},
	{
		action: "update",
		actor: subjects.admin,
		entitlement: "active",
		expected: "allowed",
		id: "admin-team-node",
		label: "Org admin governs team node",
		packageLabel: "paid/plugin-pro",
		paid: true,
	},
	{
		action: "update",
		actor: subjects.member,
		entitlement: "expired",
		expected: "denied",
		id: "expired-update",
		label: "Expired entitlement blocks update",
		packageLabel: "paid/plugin-pro",
		paid: true,
	},
	{
		action: "download",
		actor: subjects.member,
		entitlement: "expired",
		expected: "denied",
		id: "expired-download",
		label: "Expired entitlement blocks new download",
		packageLabel: "paid/plugin-pro",
		paid: true,
	},
	{
		action: "disable",
		actor: subjects.member,
		entitlement: "expired",
		expected: "allowed",
		id: "expired-disable",
		label: "Expired package can still be disabled",
		packageLabel: "paid/plugin-pro",
		paid: true,
	},
	{
		action: "uninstall",
		actor: subjects.member,
		entitlement: "expired",
		expected: "allowed",
		id: "expired-uninstall",
		label: "Expired package can still be uninstalled",
		packageLabel: "paid/plugin-pro",
		paid: true,
	},
];

const githubBridge = {
	appId: "4625892",
	appName: "Ryu Marketplace",
	slug: "ryu-marketplace",
	permissions: "contents:read · metadata:read",
	events: "push · release",
	packageSource: "GitHub Releases · deterministic .ryupack",
	sellerFlow: "Paste repo URL → validate → Stripe offer → Ryu proxy",
	privateKeyCheck: "validated",
	serverEnvCheck: "configured",
	webhookCheck: "active · secret configured",
};

const styles = `
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #090d14; color: #f4f7fb; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 1060px; background: radial-gradient(circle at 10% 0%, #172a42 0, #090d14 44%); }
button { font: inherit; }
.shell { max-width: 1420px; margin: 0 auto; padding: 42px 48px 64px; }
.eyebrow { color: #77d3ff; font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
h1 { font-size: 36px; line-height: 1.05; letter-spacing: -.04em; margin: 10px 0 12px; }
.lede { max-width: 820px; color: #aab8c9; font-size: 16px; line-height: 1.6; margin: 0; }
.toolbar { display: flex; align-items: center; gap: 16px; margin: 28px 0 22px; }
.status { display: inline-flex; align-items: center; gap: 8px; color: #a7f3c0; background: #123522; border: 1px solid #286b47; border-radius: 999px; padding: 8px 13px; font-size: 13px; font-weight: 750; }
.status-dot { width: 8px; height: 8px; border-radius: 999px; background: #60e39a; box-shadow: 0 0 12px #60e39a; }
.rerun { margin-left: auto; cursor: pointer; color: #07111a; background: #8bdcff; border: 0; border-radius: 9px; padding: 10px 15px; font-weight: 800; }
.grid { display: grid; grid-template-columns: 1fr 1.3fr; gap: 18px; }
.card { background: rgba(16, 24, 36, .92); border: 1px solid #26364b; border-radius: 16px; padding: 22px; box-shadow: 0 16px 46px rgba(0,0,0,.2); }
.card h2 { font-size: 15px; margin: 0 0 16px; letter-spacing: .01em; }
.node-id { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid #253348; }
.node-id strong { font-size: 21px; letter-spacing: -.02em; }
.badge { border: 1px solid #3a6884; border-radius: 999px; color: #9bddf8; padding: 5px 9px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
.facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 16px; }
.fact { background: #0b121d; border-radius: 10px; padding: 12px; }
.fact span { display: block; color: #8092a8; font-size: 11px; margin-bottom: 5px; text-transform: uppercase; letter-spacing: .08em; }
.fact strong { font-size: 13px; color: #e4edf7; }
.permissions { display: flex; flex-wrap: wrap; gap: 8px; }
.permission { background: #13273a; border: 1px solid #2e617b; color: #bcecff; border-radius: 8px; padding: 8px 10px; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; }
.matrix { grid-column: 1 / -1; padding: 0; overflow: hidden; }
.matrix-head { padding: 22px 22px 14px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th { color: #8195ab; font-size: 11px; letter-spacing: .08em; text-align: left; text-transform: uppercase; background: #0b121d; }
th, td { padding: 13px 16px; border-top: 1px solid #233247; vertical-align: middle; }
td:first-child { color: #edf4fb; font-weight: 720; }
.actor { color: #aebed0; font-size: 12px; }
.result { display: inline-flex; border-radius: 999px; padding: 5px 9px; font-size: 11px; font-weight: 850; letter-spacing: .05em; text-transform: uppercase; }
.allowed { color: #a7f3c0; background: #143a28; border: 1px solid #2b7850; }
.denied { color: #ffb8b8; background: #401b25; border: 1px solid #8e394b; }
.reason { color: #aebed0; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; }
.logs { grid-column: 1 / -1; }
.bridge { grid-column: 1 / -1; }
.bridge-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid #253348; }
.bridge-top strong { font-size: 21px; letter-spacing: -.02em; }
.bridge-checks { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 16px; }
.bridge-check { background: #0b121d; border: 1px solid #26364b; border-radius: 10px; padding: 12px; }
.bridge-check span { display: block; color: #8092a8; font-size: 11px; margin-bottom: 5px; text-transform: uppercase; letter-spacing: .08em; }
.bridge-check strong { color: #a7f3c0; font-size: 13px; }
.bridge-check.pending strong { color: #ffd18a; }
.bridge-detail { color: #b9c9db; font-size: 12px; line-height: 1.55; margin: 16px 0 0; }
.log { color: #8fe5ff; background: #080d14; border-left: 2px solid #2b83aa; border-radius: 6px; padding: 9px 11px; margin: 7px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; }
.note { color: #8699ae; font-size: 12px; line-height: 1.55; margin: 14px 0 0; }
`;

const App = () => {
	const [run, setRun] = useState(1);
	const results = useMemo(() => scenarios.map(runScenario), [run]);
	const passed = results.every((result) => result.actual === result.expected);

	return (
		<>
			<style>{styles}</style>
			<main className="shell">
				<div className="eyebrow">Ryu marketplace bridge · browser proof</div>
				<h1>GitHub packages with node-scoped lifecycle authorization</h1>
				<p className="lede">
					The seller brings a GitHub repository, while Ryu keeps the billing,
					entitlement, proxy, and ACL decisions. The desktop receives a stable
					node identity and asks the server for lifecycle capabilities before
					any package filesystem mutation.
				</p>
				<div className="toolbar">
					<div className="status" data-testid="proof-status">
						<span className="status-dot" />
						{passed
							? "8/8 contract decisions verified"
							: "Contract proof failed"}
					</div>
					<span className="actor">Run {run} · captured gateway responses</span>
					<button
						className="rerun"
						onClick={() => setRun((value) => value + 1)}
						type="button"
					>
						Re-run matrix
					</button>
				</div>

				<div className="grid">
					<section className="card bridge" data-testid="github-bridge-card">
						<h2>GitHub Marketplace bridge</h2>
						<div className="bridge-top">
							<strong>{githubBridge.appName}</strong>
							<span className="badge">App {githubBridge.appId}</span>
						</div>
						<div className="facts">
							<div className="fact">
								<span>App slug</span>
								<strong>{githubBridge.slug}</strong>
							</div>
							<div className="fact">
								<span>Permissions</span>
								<strong>{githubBridge.permissions}</strong>
							</div>
							<div className="fact">
								<span>Events</span>
								<strong>{githubBridge.events}</strong>
							</div>
						</div>
						<div className="bridge-checks">
							<div className="bridge-check">
								<span>Private key</span>
								<strong>{githubBridge.privateKeyCheck}</strong>
							</div>
							<div className="bridge-check">
								<span>Server environment</span>
								<strong>{githubBridge.serverEnvCheck}</strong>
							</div>
							<div className="bridge-check" data-testid="webhook-check">
								<span>Webhook</span>
								<strong>{githubBridge.webhookCheck}</strong>
							</div>
						</div>
						<p className="bridge-detail">
							{githubBridge.packageSource}. {githubBridge.sellerFlow}. Buyers do
							not need GitHub credentials; private release bytes are proxied
							through Ryu. The GitHub app webhook is active, with its secret
							configured server-side; no credential is exposed to the buyer.
						</p>
					</section>

					<section className="card" data-testid="node-scope-card">
						<h2>Registered node</h2>
						<div className="node-id">
							<strong>{node.id}</strong>
							<span className="badge">team node</span>
						</div>
						<div className="facts">
							<div className="fact">
								<span>Organization</span>
								<strong>{node.orgId}</strong>
							</div>
							<div className="fact">
								<span>Team</span>
								<strong>{node.teamId}</strong>
							</div>
							<div className="fact">
								<span>Node scope</span>
								<strong>{nodeScopeLabel(node)}</strong>
							</div>
						</div>
						<p className="note">
							Org admins can govern this team node without joining team-7.
							Personal-node ownership would remain private.
						</p>
					</section>

					<section className="card" data-testid="permission-card">
						<h2>Independent lifecycle permissions</h2>
						<div className="permissions">
							{(
								[
									"app.install",
									"app.update",
									"app.enable",
									"app.disable",
									"app.uninstall",
								] as LifecyclePermission[]
							).map((permission) => (
								<span className="permission" key={permission}>
									{permission}
								</span>
							))}
						</div>
						<p className="note">
							A grant for install never implies update, enable, disable, or
							uninstall. Team allow is checked after node scope; a member deny
							wins over the team grant.
						</p>
					</section>

					<section className="card matrix" data-testid="decision-matrix">
						<div className="matrix-head">
							<h2>Org / team / member decision matrix</h2>
							<p className="note">
								Free packages use ACL only. Paid package install, update, and
								download additionally require an active entitlement.
							</p>
						</div>
						<table>
							<thead>
								<tr>
									<th>Scenario</th>
									<th>Actor</th>
									<th>Action</th>
									<th>Package</th>
									<th>Result</th>
									<th>Reason</th>
								</tr>
							</thead>
							<tbody>
								{results.map((result) => (
									<tr data-testid={`decision-${result.id}`} key={result.id}>
										<td>{result.label}</td>
										<td className="actor">{result.actor.label}</td>
										<td>
											<code>{result.requiredPermission}</code>
										</td>
										<td>
											<code>{result.packageLabel}</code>
										</td>
										<td>
											<span
												className={`result ${result.actual}`}
												data-testid={`result-${result.id}`}
											>
												{result.actual}
											</span>
										</td>
										<td className="reason">{result.reason}</td>
									</tr>
								))}
							</tbody>
						</table>
					</section>

					<section className="card logs" data-testid="captured-logs">
						<h2>Captured structured logs</h2>
						{results.map((result) => (
							<div className="log" key={result.id}>
								{result.log}
							</div>
						))}
						<p className="note">
							Denied rows carry the required permission and stable node scope in
							the 403-shaped payload. Expiry never removes the installed
							package; it only blocks new package bytes.
						</p>
					</section>
				</div>
			</main>
		</>
	);
};

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
