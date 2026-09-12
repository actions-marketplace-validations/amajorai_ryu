import { createServer } from "node:http";

const PRO_ORG_ID = "507f1f77bcf86cd799439011";
const ENTERPRISE_ORG_ID = "507f1f77bcf86cd799439012";
const SERVER_ID = "server-proof";

const session = {
	session: {
		activeOrganizationId: ENTERPRISE_ORG_ID,
		expiresAt: "2030-01-01T00:00:00.000Z",
		token: "proof-session",
	},
	user: {
		email: "proof-admin@example.com",
		id: "proof-user",
		image: null,
		name: "Proof Admin",
		role: "admin",
	},
};

function send(response, status, body) {
	response.writeHead(status, {
		"Access-Control-Allow-Credentials": "true",
		"Access-Control-Allow-Headers": "content-type, idempotency-key",
		"Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
		"Access-Control-Allow-Origin": "http://localhost:3001",
		"Content-Type": "application/json",
	});
	response.end(JSON.stringify(body));
}

function instance(type, overrides = {}) {
	const specs = {
		cx23: [2, 4, 40, "Cost-optimized", 18],
		cx43: [8, 16, 160, "Performance", 49],
		cx53: [16, 32, 320, "Performance", 89],
	};
	const [cores, memoryGb, diskGb, perfLabel, monthlyUsd] = specs[type];
	return {
		availableInLocation: true,
		category: perfLabel === "Performance" ? "performance" : "cost-optimized",
		cores,
		diskGb,
		includedWithMax: false,
		memoryGb,
		monthlyUsd,
		perfLabel,
		type,
		...overrides,
	};
}

function catalogFor(organizationId) {
	const restricted = organizationId === PRO_ORG_ID;
	return {
		instances: [
			instance("cx23", {
				includedWithMax: restricted,
				includedWithPlan: restricted,
				monthlyUsd: restricted ? 0 : 18,
			}),
			instance("cx43", {
				includedWithPlan: false,
			}),
			instance("cx53"),
		],
		live: true,
		liveAvailability: true,
		liveLocations: true,
		liveTypes: true,
		location: "nbg1",
		locations: [{ city: "Nuremberg", country: "DE", id: "nbg1" }],
		nodeAccess: restricted
			? {
					canBuyAdditionalNodes: false,
					canUpgradeIncludedNode: false,
					enterprise: false,
					plan: "pro",
				}
			: {
					canBuyAdditionalNodes: true,
					canUpgradeIncludedNode: true,
					enterprise: true,
					plan: null,
				},
	};
}

function enterpriseServer() {
	return {
		backupsEnabled: false,
		createdAt: "2026-09-01T00:00:00.000Z",
		createdBy: "proof-user",
		detectedTimeZone: "Asia/Singapore",
		desktopEnabled: false,
		effectiveTimeZone: "Asia/Singapore",
		error: null,
		hetznerServerId: null,
		hetznerType: "cx43",
		id: SERVER_ID,
		includedWithMax: true,
		includedWithPlan: true,
		inferenceMode: "managed",
		location: "nbg1",
		monthlyUsdSnapshot: 0,
		organizationId: ENTERPRISE_ORG_ID,
		polarSubscriptionId: "sub-enterprise-plan",
		publicUrl: null,
		removeGraceEndsAt: null,
		removeScheduledAt: null,
		status: "active",
		timeZone: null,
		updatedAt: "2026-09-12T00:00:00.000Z",
	};
}

function organization(organizationId, name) {
	return {
		id: organizationId,
		logo: null,
		metadata: null,
		name,
		slug: name.toLowerCase().replaceAll(" ", "-"),
	};
}

const server = createServer((request, response) => {
	if (request.method === "OPTIONS") {
		send(response, 204, {});
		return;
	}

	const url = new URL(request.url ?? "/", "http://localhost:3000");
	const path = url.pathname;

	if (path === "/proof-health") {
		send(response, 200, { ok: true });
		return;
	}
	if (path === "/api/auth/get-session") {
		send(response, 200, session);
		return;
	}
	if (path === "/api/waitlist/me") {
		send(response, 200, { status: "approved" });
		return;
	}
	if (path === "/api/auth/organization/list") {
		send(response, 200, [
			organization(PRO_ORG_ID, "Pro workspace"),
			organization(ENTERPRISE_ORG_ID, "Enterprise workspace"),
		]);
		return;
	}
	if (path === "/api/auth/organization/get-full-organization") {
		send(
			response,
			200,
			organization(ENTERPRISE_ORG_ID, "Enterprise workspace")
		);
		return;
	}
	if (path === "/api/auth/organization/get-active-member") {
		send(response, 200, {
			id: "member-proof",
			organizationId: ENTERPRISE_ORG_ID,
			role: "owner",
			userId: "proof-user",
		});
		return;
	}
	if (path === "/api/auth/organization/get-active-member-role") {
		send(response, 200, { role: "owner" });
		return;
	}
	if (path === "/api/billing/subscription-status") {
		send(response, 200, {
			hasProSubscription: true,
			isLifetime: false,
			plan: "pro",
		});
		return;
	}
	if (path === "/api/control-plane/me/permissions") {
		send(response, 200, {
			permissions: ["billing.manage", "nodes.manage"],
		});
		return;
	}
	if (path === "/api/servers/catalog") {
		send(response, 200, catalogFor(url.searchParams.get("orgId")));
		return;
	}
	if (path === `/api/servers/orgs/${ENTERPRISE_ORG_ID}/servers/${SERVER_ID}`) {
		send(response, 200, enterpriseServer());
		return;
	}
	if (path === `/api/servers/orgs/${PRO_ORG_ID}/servers`) {
		send(response, 200, { servers: [] });
		return;
	}
	if (path === `/api/servers/orgs/${ENTERPRISE_ORG_ID}/servers`) {
		send(response, 200, { servers: [enterpriseServer()] });
		return;
	}

	send(response, 404, {
		error: `Proof route not stubbed: ${request.method} ${path}`,
	});
});

server.listen(3000, "127.0.0.1", () => {
	console.log("node billing proof server listening on 127.0.0.1:3000");
});
