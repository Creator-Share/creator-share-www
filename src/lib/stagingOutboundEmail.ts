import "server-only"

import {
  isAdvocateStagingEnvironmentEnabled,
  type AdvocateHostEnvironment,
} from "@/lib/advocates/host"

export const ADVOCATE_STAGING_SMTP_HOST = "smtp.ethereal.email"
export const ADVOCATE_STAGING_SMTP_PORT = 587
export const ADVOCATE_STAGING_SMTP_TLS_OPTIONS = Object.freeze({
  requireTLS: true,
  tls: Object.freeze({
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
  }),
})

const ETHEREAL_MAILBOX_IDENTITY_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@ethereal\.email$/
const FF029_CANARY_RECIPIENT_PATTERN =
  /^creator-share-ff029-[0-9a-f]{32}@example\.com$/

export interface AdvocateStagingEmailRecipientPolicy {
  mailboxIdentity: string
  canaryContract: "creator-share-ff029-v1"
}

export class AdvocateStagingOutboundEmailBoundaryError extends Error {
  constructor() {
    super("advocate_staging_outbound_email_boundary_rejected")
    this.name = "AdvocateStagingOutboundEmailBoundaryError"
  }
}

/**
 * Exact advocate staging may use only Ethereal's submission endpoint with
 * mandatory STARTTLS. Nodemailer's `secure: false` selects STARTTLS on port
 * 587, while both email transports independently set `requireTLS: true`.
 */
export function loadAdvocateStagingEmailRecipientPolicy(options: {
  environment: AdvocateHostEnvironment
  host: string
  port: number
  secure: boolean
  username: string
}): AdvocateStagingEmailRecipientPolicy | undefined {
  if (!isAdvocateStagingEnvironmentEnabled(options.environment)) {
    return undefined
  }

  if (
    options.host !== ADVOCATE_STAGING_SMTP_HOST ||
    options.port !== ADVOCATE_STAGING_SMTP_PORT ||
    options.secure ||
    options.username !== options.username.toLowerCase() ||
    !ETHEREAL_MAILBOX_IDENTITY_PATTERN.test(options.username)
  ) {
    throw new AdvocateStagingOutboundEmailBoundaryError()
  }

  return Object.freeze({
    mailboxIdentity: options.username,
    canaryContract: "creator-share-ff029-v1",
  })
}

export function isAdvocateStagingEmailRecipientAllowed(
  recipientEmail: string,
  policy: AdvocateStagingEmailRecipientPolicy,
): boolean {
  if (
    recipientEmail.length < 1 ||
    recipientEmail.length > 254 ||
    recipientEmail !== recipientEmail.trim() ||
    /[\r\n\0]/.test(recipientEmail)
  ) {
    return false
  }

  const normalizedRecipient = recipientEmail.toLowerCase()
  return (
    normalizedRecipient === policy.mailboxIdentity ||
    (recipientEmail === normalizedRecipient &&
      FF029_CANARY_RECIPIENT_PATTERN.test(recipientEmail))
  )
}

export function assertAdvocateStagingEmailRecipientAllowed(
  recipientEmail: string,
  policy: AdvocateStagingEmailRecipientPolicy,
): void {
  if (!isAdvocateStagingEmailRecipientAllowed(recipientEmail, policy)) {
    throw new AdvocateStagingOutboundEmailBoundaryError()
  }
}

/**
 * The legacy mail utility is still used by several older application routes.
 * Keep those routes inside the same exact staging transport and recipient
 * boundary until they are migrated to durable outboxes.
 */
export function assertAdvocateStagingLegacyEmailAllowed(
  recipientEmail: string,
  environment: AdvocateHostEnvironment = process.env,
): void {
  assertAdvocateStagingEnvironmentEmailRecipientAllowed(
    recipientEmail,
    environment,
  )
}

/**
 * Shared staging recipient fence for application SMTP and Supabase Auth
 * issuance. Hosted Auth SMTP remains separately verified provider state.
 */
export function assertAdvocateStagingEnvironmentEmailRecipientAllowed(
  recipientEmail: string,
  environment: AdvocateHostEnvironment = process.env,
): void {
  if (!isAdvocateStagingEnvironmentEnabled(environment)) return
  if (
    environment.EMAIL_PORT !== "587" ||
    environment.EMAIL_SECURE !== "false"
  ) {
    throw new AdvocateStagingOutboundEmailBoundaryError()
  }

  const policy = loadAdvocateStagingEmailRecipientPolicy({
    environment,
    host: environment.EMAIL_HOST ?? "",
    port: 587,
    secure: false,
    username: environment.EMAIL_USER ?? "",
  })
  if (policy === undefined) {
    throw new AdvocateStagingOutboundEmailBoundaryError()
  }
  assertAdvocateStagingEmailRecipientAllowed(recipientEmail, policy)
}

export function advocateStagingLegacyEmailTransportSecurityOptions(
  environment: AdvocateHostEnvironment = process.env,
): Record<string, unknown> {
  return isAdvocateStagingEnvironmentEnabled(environment)
    ? ADVOCATE_STAGING_SMTP_TLS_OPTIONS
    : {}
}
