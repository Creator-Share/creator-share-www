import "server-only"

import {
  buildAdvocateInvitationLink,
  type AdvocateInvitationAuthType,
} from "@/lib/advocates/invitations/material"

import type { AdvocateInvitationEmailTemplateData } from "./emailEnvelope"

export const ADVOCATE_INVITATION_EMAIL_SUBJECT =
  "You are invited to a Creator Share advocate portal"
export const ADVOCATE_INITIAL_OWNER_INVITATION_EMAIL_SUBJECT =
  "Claim your Creator Share advocate portal"

const ROLE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  administrator: "Administrator",
  brand_editor: "Brand editor",
  catalog_curator: "Child catalog curator",
  analytics_viewer: "Analytics viewer",
  audit_viewer: "Audit viewer",
})

export interface RenderedAdvocateInvitationEmail {
  subject:
    | typeof ADVOCATE_INVITATION_EMAIL_SUBJECT
    | typeof ADVOCATE_INITIAL_OWNER_INVITATION_EMAIL_SUBJECT
  text: string
  html: string
  invitationUrl: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function renderInitialOwnerInvitationEmail(options: {
  invitationUrl: string
  advocateDisplayName: string
}): RenderedAdvocateInvitationEmail {
  const escapedUrl = escapeHtml(options.invitationUrl)
  const escapedAdvocate = escapeHtml(options.advocateDisplayName)
  const text = [
    `${options.advocateDisplayName} has been reserved as your Creator Share advocate portal.`,
    "",
    "Claim ownership securely:",
    options.invitationUrl,
    "",
    "After you accept, Creator Share will begin the protected domain and payment provider setup. The portal will remain private until every required readiness check passes and Creator Share approves publication.",
    "",
    "This invitation remains pending for up to seven days, but the secure email sign-in proof expires sooner. If the link has expired, contact Creator Share for a new invitation.",
    "",
    "This private link is intended only for you. Do not forward it.",
    "",
    "Questions? Email support@creatorshare.com.",
  ].join("\n")

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${ADVOCATE_INITIAL_OWNER_INVITATION_EMAIL_SUBJECT}</title>
  </head>
  <body style="margin:0;background:#f6f8fb;color:#172033;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr><td style="background:#1c3c8c;color:#ffffff;padding:24px 32px;font-size:24px;font-weight:700;">Creator Share</td></tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 20px;font-size:28px;line-height:1.25;color:#172033;">Claim ${escapedAdvocate}</h1>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">This Creator Share advocate portal has been reserved for you.</p>
                <p style="margin:0 0 24px;text-align:center;">
                  <a href="${escapedUrl}" style="display:inline-block;background:#1c3c8c;color:#ffffff;text-decoration:none;border-radius:8px;padding:14px 22px;font-size:16px;font-weight:700;">Claim portal ownership</a>
                </p>
                <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#526078;">After you accept, Creator Share will begin the protected domain and payment provider setup. The portal will remain private until every required readiness check passes and Creator Share approves publication.</p>
                <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#526078;">This invitation remains pending for up to seven days, but the secure email sign-in proof expires sooner. If the link has expired, contact Creator Share for a new invitation.</p>
                <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#526078;">This private link is intended only for you. Do not forward it.</p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#526078;">Questions? <a href="mailto:support@creatorshare.com" style="color:#1c3c8c;">support@creatorshare.com</a></p>
              </td>
            </tr>
            <tr><td style="border-top:1px solid #e4e8ef;padding:20px 32px;font-size:12px;line-height:1.5;color:#6b7485;">Creator Share protects sponsor and advocate contact information.</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return {
    subject: ADVOCATE_INITIAL_OWNER_INVITATION_EMAIL_SUBJECT,
    text,
    html,
    invitationUrl: options.invitationUrl,
  }
}

export function renderAdvocateInvitationEmail(options: {
  canonicalOrigin: string
  template: AdvocateInvitationEmailTemplateData
  authTokenHash: string
  authType: AdvocateInvitationAuthType
  capability: string
}): RenderedAdvocateInvitationEmail {
  const invitationUrl = buildAdvocateInvitationLink({
    canonicalOrigin: options.canonicalOrigin,
    material: {
      version: 1,
      authType: options.authType,
      authTokenHash: options.authTokenHash,
      capability: options.capability,
    },
  })
  if (options.template.templateKey === "advocate_initial_owner_invitation_v1") {
    return renderInitialOwnerInvitationEmail({
      invitationUrl,
      advocateDisplayName: options.template.advocateDisplayName,
    })
  }
  const roleLabels = options.template.roleKeys.map(
    (roleKey) => ROLE_LABELS[roleKey],
  )
  if (roleLabels.some((label) => typeof label !== "string")) {
    throw new Error("advocate_invitation_email_template_invalid")
  }
  const roles = roleLabels.join(", ")
  const escapedUrl = escapeHtml(invitationUrl)
  const escapedAdvocate = escapeHtml(options.template.advocateDisplayName)
  const escapedRoles = escapeHtml(roles)

  const text = [
    `You have been invited to help manage ${options.template.advocateDisplayName} on Creator Share.`,
    "",
    `Access: ${roles}`,
    "",
    "Accept your invitation securely:",
    invitationUrl,
    "",
    "This invitation remains pending for up to seven days, but the secure email sign-in proof expires sooner. If the link has expired, ask a portal administrator to resend the invitation while it is still pending.",
    "",
    "This private link is intended only for you. Do not forward it.",
    "",
    "Questions? Email support@creatorshare.com.",
  ].join("\n")

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${ADVOCATE_INVITATION_EMAIL_SUBJECT}</title>
  </head>
  <body style="margin:0;background:#f6f8fb;color:#172033;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr><td style="background:#1c3c8c;color:#ffffff;padding:24px 32px;font-size:24px;font-weight:700;">Creator Share</td></tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 20px;font-size:28px;line-height:1.25;color:#172033;">Join ${escapedAdvocate}</h1>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">You have been invited to help manage this Creator Share advocate portal.</p>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.6;"><strong>Access:</strong> ${escapedRoles}</p>
                <p style="margin:0 0 24px;text-align:center;">
                  <a href="${escapedUrl}" style="display:inline-block;background:#1c3c8c;color:#ffffff;text-decoration:none;border-radius:8px;padding:14px 22px;font-size:16px;font-weight:700;">Accept invitation</a>
                </p>
                <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#526078;">This invitation remains pending for up to seven days, but the secure email sign-in proof expires sooner. If the link has expired, ask a portal administrator to resend it while the invitation is still pending.</p>
                <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#526078;">This private link is intended only for you. Do not forward it.</p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#526078;">Questions? <a href="mailto:support@creatorshare.com" style="color:#1c3c8c;">support@creatorshare.com</a></p>
              </td>
            </tr>
            <tr><td style="border-top:1px solid #e4e8ef;padding:20px 32px;font-size:12px;line-height:1.5;color:#6b7485;">Creator Share protects sponsor and delegate contact information.</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return {
    subject: ADVOCATE_INVITATION_EMAIL_SUBJECT,
    text,
    html,
    invitationUrl,
  }
}
