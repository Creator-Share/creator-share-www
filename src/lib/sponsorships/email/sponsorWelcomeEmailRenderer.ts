import "server-only"

import { buildSponsorClaimWelcomeUrl } from "@/lib/sponsorships/accountClaim"
import type { SponsorshipCrypto } from "@/lib/sponsorships/crypto"

export const SPONSOR_WELCOME_EMAIL_SUBJECT =
  "Welcome to the Creator Share family"

export interface RenderedSponsorWelcomeEmail {
  subject: typeof SPONSOR_WELCOME_EMAIL_SUBJECT
  text: string
  html: string
  claimUrl: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

export function renderSponsorWelcomeEmail(options: {
  canonicalOrigin: string
  recipientEmail: string
  claimToken: string
  crypto: SponsorshipCrypto
}): RenderedSponsorWelcomeEmail {
  const claimUrl = buildSponsorClaimWelcomeUrl(
    options.canonicalOrigin,
    options.claimToken,
    options.recipientEmail,
    options.crypto,
  )
  const escapedClaimUrl = escapeHtml(claimUrl)

  const text = [
    "Welcome to the Creator Share family.",
    "",
    "Thank you for sponsoring a child. Your generosity creates reliable, dignified support and a real relationship between people who care.",
    "",
    "Create or access your secure Creator Share account to see your sponsorships, manage recurring sponsorships, and cancel a subscription whenever necessary:",
    claimUrl,
    "",
    "This private link is intended only for the email address used for your sponsorship. If it expires, Creator Share can send a new secure sign-in link.",
    "",
    "Questions? Email support@creatorshare.com.",
    "",
    "Creator Share keeps sponsor contact information private.",
  ].join("\n")

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${SPONSOR_WELCOME_EMAIL_SUBJECT}</title>
  </head>
  <body style="margin:0;background:#f6f8fb;color:#172033;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr><td style="background:#1c3c8c;color:#ffffff;padding:24px 32px;font-size:24px;font-weight:700;">Creator Share</td></tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 20px;font-size:28px;line-height:1.25;color:#172033;">Welcome to the family</h1>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">Thank you for sponsoring a child. Your generosity creates reliable, dignified support and a real relationship between people who care.</p>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">Create or access your secure Creator Share account to see your sponsorships, manage recurring sponsorships, and cancel a subscription whenever necessary.</p>
                <p style="margin:0 0 24px;text-align:center;">
                  <a href="${escapedClaimUrl}" style="display:inline-block;background:#1c3c8c;color:#ffffff;text-decoration:none;border-radius:8px;padding:14px 22px;font-size:16px;font-weight:700;">Create or manage your account</a>
                </p>
                <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#526078;">This private link is intended only for the email address used for your sponsorship. If it expires, Creator Share can send a new secure sign-in link.</p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#526078;">Questions? <a href="mailto:support@creatorshare.com" style="color:#1c3c8c;">support@creatorshare.com</a></p>
              </td>
            </tr>
            <tr><td style="border-top:1px solid #e4e8ef;padding:20px 32px;font-size:12px;line-height:1.5;color:#6b7485;">Creator Share keeps sponsor contact information private.</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return {
    subject: SPONSOR_WELCOME_EMAIL_SUBJECT,
    text,
    html,
    claimUrl,
  }
}
