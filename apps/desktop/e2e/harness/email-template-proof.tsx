import { render } from "@react-email/render";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import AccountExistsEmail from "../../../../packages/email/src/emails/account-exists-email.tsx";
import ApplicationInviteEmail from "../../../../packages/email/src/emails/application-invite-email.tsx";
import DeleteAccountEmail from "../../../../packages/email/src/emails/delete-account-email.tsx";
import EmailChangeVerificationToNewEmail from "../../../../packages/email/src/emails/email-change-verification-new.tsx";
import EmailVerificationOTPEmail from "../../../../packages/email/src/emails/email-verification-otp-email.tsx";
import MagicLinkEmail from "../../../../packages/email/src/emails/magic-link-email.tsx";
import OrganizationInvitationEmail from "../../../../packages/email/src/emails/organization-invitation-email.tsx";
import PasswordResetEmail from "../../../../packages/email/src/emails/password-reset-email.tsx";
import PasswordResetOTPEmail from "../../../../packages/email/src/emails/password-reset-otp-email.tsx";
import SignInOTPEmail from "../../../../packages/email/src/emails/sign-in-otp-email.tsx";
import StaleAccountAdminEmail from "../../../../packages/email/src/emails/stale-account-admin-email.tsx";
import StaleAccountUserEmail from "../../../../packages/email/src/emails/stale-account-user-email.tsx";
import TwoFactorOTPEmail from "../../../../packages/email/src/emails/two-factor-otp-email.tsx";
import VerificationEmail from "../../../../packages/email/src/emails/verification-email.tsx";
import WaitlistConfirmationEmail from "../../../../packages/email/src/emails/waitlist-confirmation-email.tsx";

const EMAILS: Array<{ label: string; content: ReactElement }> = [
	{
		label: "verify-email · New sign-up",
		content: (
			<VerificationEmail
				userName="Ada"
				verificationUrl="https://ryuhq.com/verify?token=proof"
			/>
		),
	},
	{
		label: "reset-password · Password link",
		content: (
			<PasswordResetEmail
				resetUrl="https://ryuhq.com/login?view=reset&token=proof"
				userName="Ada"
			/>
		),
	},
	{
		label: "change-email · New address",
		content: (
			<EmailChangeVerificationToNewEmail
				newEmail="ada.new@example.com"
				oldEmail="ada@example.com"
				userName="Ada"
				verificationUrl="https://ryuhq.com/email-change?token=proof"
			/>
		),
	},
	{
		label: "sign-in-otp · Passwordless sign-in",
		content: <SignInOTPEmail otpCode="482913" userName="Ada" />,
	},
	{
		label: "verify-email-otp · Email verification",
		content: <EmailVerificationOTPEmail otpCode="123456" userName="Ada" />,
	},
	{
		label: "reset-password-otp · Password recovery",
		content: <PasswordResetOTPEmail otpCode="654321" userName="Ada" />,
	},
	{
		label: "magic-link · One-click sign-in",
		content: (
			<MagicLinkEmail
				magicLinkUrl="https://ryuhq.com/magic?token=proof"
				userName="Ada"
			/>
		),
	},
	{
		label: "two-factor · Second factor",
		content: <TwoFactorOTPEmail otpCode="741852" userName="Ada" />,
	},
	{
		label: "invitation · Organization",
		content: (
			<OrganizationInvitationEmail
				invitedByName="Jordan"
				inviteUrl="https://ryuhq.com/organizations/accept/proof"
				organizationName="Acme"
			/>
		),
	},
	{
		label: "application-invite · Ryu",
		content: (
			<ApplicationInviteEmail
				inviteeEmail="ada@example.com"
				inviteeName="Ada"
				inviteLink="https://ryuhq.com/login"
				inviterName="The Ryu team"
			/>
		),
	},
	{
		label: "delete-account · Confirmation",
		content: (
			<DeleteAccountEmail
				deletionUrl="https://ryuhq.com/delete?token=proof"
				userEmail="ada@example.com"
				userName="Ada"
			/>
		),
	},
	{
		label: "stale-account-user · Security alert",
		content: (
			<StaleAccountUserEmail
				daysSinceLastActive={120}
				loginDevice="Chrome on macOS"
				loginIp="203.0.113.7"
				loginTime="Aug 21, 2026, 04:00 AM UTC"
				securityUrl="https://ryuhq.com/settings?tab=account"
				userEmail="ada@example.com"
				userName="Ada"
			/>
		),
	},
	{
		label: "stale-account-admin · Admin alert",
		content: (
			<StaleAccountAdminEmail
				adminEmail="admin@example.com"
				daysSinceLastActive={120}
				loginDevice="Chrome on macOS"
				loginIp="203.0.113.7"
				loginTime="Aug 21, 2026, 04:00 AM UTC"
				userEmail="ada@example.com"
				userId="user_ada"
				userName="Ada"
			/>
		),
	},
	{
		label: "Ryu account exists · Compatibility",
		content: (
			<AccountExistsEmail
				resetPasswordUrl="https://ryuhq.com/login?view=forgot"
				signInUrl="https://ryuhq.com/login?view=signin"
				userName="Ada"
			/>
		),
	},
	{
		label: "Waitlist confirmation · Compatibility",
		content: (
			<WaitlistConfirmationEmail
				name="Ada"
				position={42}
				referralUrl="https://ryuhq.com/ref/proof"
			/>
		),
	},
];

function EmailCard({ label, content }: (typeof EMAILS)[number]) {
	const [html, setHtml] = useState("");

	useEffect(() => {
		let active = true;
		void render(content).then((nextHtml) => {
			if (active) {
				setHtml(nextHtml);
			}
		});
		return () => {
			active = false;
		};
	}, [content]);

	return (
		<section className="card">
			<h2>{label}</h2>
			{html ? (
				<iframe srcDoc={html} title={`${label} rendered email`} />
			) : (
				<div className="loading" role="status">
					Rendering email preview…
				</div>
			)}
		</section>
	);
}

function Proof() {
	return (
		<main>
			<header>
				<p className="eyebrow">Ryu lifecycle email proof</p>
				<h1>13 Better Auth email templates, rendered in Ryu.</h1>
				<p>
					Every available auth template has a distinct renderer. The
					compatibility cards below are existing Ryu lifecycle emails outside
					the Better Auth template vocabulary.
				</p>
			</header>
			<div className="grid">
				{EMAILS.map((email) => (
					<EmailCard key={email.label} {...email} />
				))}
			</div>
		</main>
	);
}

const style = document.createElement("style");
style.textContent = `
	:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
	* { box-sizing: border-box; }
	body { margin: 0; background: #0b0b0c; color: #f4f4f5; }
	main { max-width: 1440px; margin: 0 auto; padding: 48px; }
	header { max-width: 700px; margin-bottom: 28px; }
	.eyebrow { color: #a1a1aa; font-size: 12px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
	h1 { margin: 12px 0; font-size: clamp(28px, 4vw, 48px); letter-spacing: -.04em; }
	header p:last-child { color: #a1a1aa; font-size: 16px; line-height: 1.6; }
	.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
	.card { overflow: hidden; border: 1px solid #27272a; border-radius: 18px; background: #161618; box-shadow: 0 20px 60px #0006; }
	.card h2 { margin: 0; padding: 16px 20px; color: #d4d4d8; font-size: 14px; }
	.loading { display: grid; height: 690px; place-items: center; color: #71717a; font-size: 14px; }
	iframe { display: block; width: 100%; height: 690px; border: 0; background: #fff; }
	@media (max-width: 1200px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@media (max-width: 900px) { main { padding: 24px; } .grid { grid-template-columns: 1fr; } }
`;
document.head.append(style);

createRoot(document.getElementById("root") as HTMLElement).render(<Proof />);
