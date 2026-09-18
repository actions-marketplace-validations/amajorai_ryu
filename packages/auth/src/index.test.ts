import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const authIndex = fileURLToPath(new URL("./index.ts", import.meta.url));

const configuresCaptchaAsExpected = (
	turnstileSecret: string,
	nodeEnv = "test"
): boolean => {
	const shouldInstall =
		turnstileSecret.trim().length > 0 || nodeEnv === "production";
	const source = `
		const { auth } = await import(${JSON.stringify(authIndex)});
		const hasCaptcha = (auth.options.plugins ?? [])
			.map((plugin) => plugin.id)
			.some((id) => id === "captcha");
		process.exit(hasCaptcha === ${shouldInstall} ? 0 : 1);
	`;
	const run = spawnSync(process.execPath, ["-e", source], {
		cwd: repoRoot,
		encoding: "utf8",
		env: {
			...process.env,
			BETTER_AUTH_SECRET: "auth-config-test-secret-long-enough-2026",
			BETTER_AUTH_URL: "http://localhost:3000",
			DATABASE_URL: "mongodb://127.0.0.1:27017/ryu-auth-config-test",
			NODE_ENV: nodeEnv,
			POLAR_ACCESS_TOKEN: "local-test",
			POLAR_BILLING_AUTHORITY: "local",
			POLAR_SERVER: "sandbox",
			POLAR_SUCCESS_URL: "http://localhost:3001/success",
			RYU_DIR: "/tmp/ryu-dev-headless",
			RYU_KEYCHAIN: "off",
			RYU_PROFILE: "dev",
			SKIP_ENV_VALIDATION: "1",
			TURNSTILE_SECRET_KEY: turnstileSecret,
		},
		timeout: 30_000,
	});

	return run.error === undefined && run.status === 0;
};

describe("Better Auth CAPTCHA configuration", () => {
	test("only installs the CAPTCHA plugin when a Turnstile secret is configured", () => {
		expect(configuresCaptchaAsExpected("")).toBe(true);
		expect(configuresCaptchaAsExpected("synthetic-turnstile-secret")).toBe(
			true
		);
		expect(configuresCaptchaAsExpected("", "production")).toBe(true);
	});
});
