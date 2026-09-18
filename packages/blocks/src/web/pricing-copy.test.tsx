import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	HostedAgentPlanCard,
	MarketplacePassPlanCard,
	PlusPlanCard,
	PRO_MONTHLY_USD,
	PricingBillingToggle,
	PricingDeploymentToggle,
	PricingInstancePicker,
	PricingPlanGrid,
} from "./pricing.tsx";

test("pricing cloud instances use server terminology", () => {
	const html = renderToStaticMarkup(
		<PricingInstancePicker
			instances={[
				{
					availableInLocation: true,
					cores: 2,
					diskGb: 40,
					includedWithMax: false,
					memoryGb: 4,
					monthlyUsd: 12,
					perfLabel: "Balanced",
					type: "cx23",
				},
			]}
			locations={[]}
		/>
	);

	expect(html).toContain(
		"We host Core, Gateway, and your agents on your server."
	);
	expect(html).toContain("Deploy server");
	expect(html).not.toContain("Deploy node");
	expect(html).not.toContain("managed node");
});

test("Major Pass uses the shared palette and whole-dollar annual pricing", () => {
	const monthly = renderToStaticMarkup(<MarketplacePassPlanCard />);
	const yearly = renderToStaticMarkup(<MarketplacePassPlanCard isYearly />);

	expect(monthly).toContain('title="Ryu A Major Pass"');
	expect(monthly).toContain("A MAJOR PASS");
	expect(monthly).toContain("One individual user is included");
	expect(monthly).toContain(
		"One pass gives one individual user access to supported paid Marketplace apps"
	);
	expect(monthly).not.toContain("and publishers");
	expect(monthly).not.toContain("marketplace-pass-users");
	expect(monthly).toMatch(/\$<span[^>]*>2<\/span><span[^>]*>0<\/span>/);
	expect(monthly).not.toContain("$20.00");
	expect(yearly).toMatch(
		/\$<span[^>]*>2<\/span><span[^>]*>0<\/span><span[^>]*>0<\/span>/
	);
	expect(yearly).not.toContain("$200.00");
	expect(yearly).toContain('aria-label="$17"');
});

test("the public business shelf omits the seat-sizing explainer", () => {
	const html = renderToStaticMarkup(<PricingPlanGrid audience="business" />);

	expect(html).not.toContain("Choose who needs to use the software");
	expect(html).not.toContain("Multiple teams");
	expect(html).not.toContain("pooled credits");
	expect(html).toContain("5 seats included");
	expect(html).not.toContain("Teams Lite");
	expect(html).not.toContain("Ryu Plus");
	expect(html).not.toContain("people can share");
	expect(html).not.toContain("Your organization gets");
	expect(html).toContain("26% deposit fee ($5 minimum)");
	expect(html).not.toContain("This price covers");
	expect(html).toContain("border-border/70 border-b pb-3");
	expect(html).not.toContain("border-border/70 border-y py-3");
	expect(html).not.toMatch(/\.\s*<\/(?:span|p)>/);
});

test("the private Plus offer keeps its lower usage contract", () => {
	const html = renderToStaticMarkup(<PlusPlanCard isYearly />);

	expect(html).toContain("PLUS");
	expect(html).toContain("Private offer");
	expect(html).toContain("$10");
	expect(html).toContain("$390");
	expect(html).not.toContain("Ryu Pro");
});

test("pricing defaults to the organization shelf", () => {
	const html = renderToStaticMarkup(<PricingPlanGrid />);

	expect(html).toContain("5 seats included");
	expect(html).not.toContain("Local Desktop");
});

test("the public individual shelf exposes the local desktop offer", () => {
	const html = renderToStaticMarkup(<PricingPlanGrid audience="individual" />);

	expect(html).toContain("Local Desktop");
	expect(html).not.toContain("Ryu Plus");
	expect(html).toMatch(
		/\$<span[^>]*>1<\/span><span[^>]*>2<\/span><span[^>]*>9<\/span>/
	);
	expect(html).toContain("$200");
});

test("the public Pro offer uses the current margin-safe price", () => {
	expect(PRO_MONTHLY_USD).toBe(49);
	const newBuyer = renderToStaticMarkup(
		<PricingPlanGrid audience="individual" />
	);
	const existingBuyer = renderToStaticMarkup(
		<PricingPlanGrid audience="individual" currentPlan="desktop-license" />
	);

	expect(newBuyer).toContain("Start with Pro");
	expect(newBuyer).toContain("Start with Max");
	expect(existingBuyer).toContain(">Upgrade<");
});

test("the hosted cards use the current included capacity ladder", () => {
	const teams = renderToStaticMarkup(
		<HostedAgentPlanCard agentCount={5} planId="teams" />
	);
	const teamsAtFifty = renderToStaticMarkup(
		<HostedAgentPlanCard agentCount={50} planId="teams" />
	);
	const business = renderToStaticMarkup(
		<HostedAgentPlanCard agentCount={5} planId="business" />
	);

	expect(teams).toContain("8 vCPU, 16 GB RAM, and 160 GB SSD");
	expect(teamsAtFifty).toContain(
		"Two managed servers with 8 vCPU, 16 GB RAM, and 160 GB SSD each"
	);
	expect(business).toContain("16 vCPU, 32 GB RAM, and 320 GB SSD");
	expect(teams).not.toContain("2 vCPU, 4 GB RAM, and 40 GB SSD");
	expect(teams).toContain("Centralized team billing and settings");
	expect(teams).toContain("Team marketplace for skills and plugins");
	expect(teams).toContain("Shared usage analytics");
	expect(business).not.toContain("4 vCPU, 8 GB RAM, and 160 GB SSD");
});

test("yearly individual prices show the discounted monthly equivalent and annual charge", () => {
	const monthly = renderToStaticMarkup(
		<PricingPlanGrid audience="individual" />
	);
	const yearly = renderToStaticMarkup(
		<PricingPlanGrid audience="individual" isYearly />
	);

	expect(monthly).toContain('aria-label="$49"');
	expect(monthly).toContain('aria-label="$99"');
	expect(yearly).toContain('aria-label="$41"');
	expect(yearly).toContain('aria-label="$83"');
	expect(yearly).toContain('aria-label="$490"');
	expect(yearly).toContain('aria-label="$990"');
	expect(yearly).not.toMatch(/aria-label="\$[\d,]+\./);
});

test("yearly organization prices scale the discounted quote with the seat count", () => {
	for (const {
		planId,
		seats,
		monthlyPrice,
		yearlyEquivalent,
		annualCharge,
	} of [
		{
			planId: "teams",
			seats: 5,
			monthlyPrice: "$250",
			yearlyEquivalent: "$208",
			annualCharge: "$2,500",
		},
		{
			planId: "teams",
			seats: 6,
			monthlyPrice: "$300",
			yearlyEquivalent: "$250",
			annualCharge: "$3,000",
		},
		{
			planId: "business",
			seats: 5,
			monthlyPrice: "$300",
			yearlyEquivalent: "$250",
			annualCharge: "$3,000",
		},
		{
			planId: "business",
			seats: 6,
			monthlyPrice: "$350",
			yearlyEquivalent: "$292",
			annualCharge: "$3,500",
		},
	] as const) {
		const monthly = renderToStaticMarkup(
			<HostedAgentPlanCard agentCount={seats} planId={planId} />
		);
		const yearly = renderToStaticMarkup(
			<HostedAgentPlanCard agentCount={seats} isYearly planId={planId} />
		);
		expect(monthly).toContain(`aria-label="${monthlyPrice}"`);
		expect(yearly).toContain(`aria-label="${yearlyEquivalent}"`);
		expect(yearly).toContain(`aria-label="${annualCharge}"`);
		expect(yearly).not.toMatch(/aria-label="\$[\d,]+\./);
		expect(yearly).toContain("per year, two months free");
	}
});

test("the active billing option reverses its foreground and background", () => {
	const html = renderToStaticMarkup(<PricingBillingToggle isYearly />);

	expect(html).toContain("data-active:bg-foreground");
	expect(html).toContain("data-active:text-background");
	expect(html).toContain("data-active:[&amp;_span]:text-background");
	expect(html).not.toContain("data-active:[&_span]:text-foreground");
});

test("the deployment switch uses the platform and self-hosted labels", () => {
	const html = renderToStaticMarkup(<PricingDeploymentToggle />);

	expect(html).toContain("Ryu Platform");
	expect(html).toContain("Self-Hosted");
	expect(html).toContain("text-xl");
});
