import "server-only"

import { createHash, randomBytes } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { AdvocateDelegateRoleKey } from "@/lib/advocates/admin/teamContracts"
import {
  type AdvocateInvitationIssueInput,
  parseAdvocatePendingInvitations,
} from "@/lib/advocates/invitations/administrationContracts"
import {
  createSponsorshipCryptoFromEnvironment,
  type SponsorshipCrypto,
  type SupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CAPABILITY_PATTERN = /^[0-9a-f]{64}$/

type SupabaseErrorLike = Readonly<{ code?: string }> | null

export interface AdvocateInvitationAuditContext {
  requestId: string
  traceId: string | null
  sessionId: string | null
  clientIp: string | null
  userAgent: string | null
}

export interface PreparedAdvocateInvitationDelivery {
  capability: string
  capabilityDigest: SupabaseRpcBytea
  normalizedEmail: string
  recipientEmailCiphertext: SupabaseRpcBytea
  recipientEmailHmac: SupabaseRpcBytea
  secretPayloadCiphertext: SupabaseRpcBytea
  emailNormalizationVersion: number
  emailHmacKeyVersion: number
  emailEncryptionKeyVersion: number
}

export interface IssuedAdvocateInvitation {
  invitationId: string
  expiresAt: string
  created: boolean
}

export class AdvocateInvitationRepositoryError extends Error {
  readonly stage: "issue" | "load" | "revoke" | "shape" | "material"
  readonly postgresCode: string | undefined

  constructor(
    stage: "issue" | "load" | "revoke" | "shape" | "material",
    cause: SupabaseErrorLike = null,
  ) {
    super("advocate_invitation_unavailable", { cause })
    this.name = "AdvocateInvitationRepositoryError"
    this.stage = stage
    this.postgresCode = cause?.code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toOneRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : null
    : value
  return isRecord(row) ? row : null
}

function parseIssuedInvitation(
  value: unknown,
): IssuedAdvocateInvitation | null {
  const row = toOneRow(value)
  if (row === null) return null
  const keys = Object.keys(row).sort()
  if (
    keys.length !== 4 ||
    keys[0] !== "created" ||
    keys[1] !== "expires_at" ||
    keys[2] !== "invitation_id" ||
    keys[3] !== "outbox_id"
  ) {
    return null
  }

  const invitationId = row.invitation_id
  const outboxId = row.outbox_id
  const expiresAt = row.expires_at
  if (
    typeof invitationId !== "string" ||
    !UUID_PATTERN.test(invitationId) ||
    typeof outboxId !== "string" ||
    !UUID_PATTERN.test(outboxId) ||
    typeof expiresAt !== "string" ||
    expiresAt.length > 64 ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    typeof row.created !== "boolean"
  ) {
    return null
  }
  return Object.freeze({
    invitationId,
    expiresAt,
    created: row.created,
  })
}

export function prepareAdvocateInvitationDelivery(
  email: string,
  options: {
    crypto?: SponsorshipCrypto
    randomBytes?: (size: number) => Uint8Array
  } = {},
): PreparedAdvocateInvitationDelivery {
  try {
    const crypto = options.crypto ?? createSponsorshipCryptoFromEnvironment()
    const random = options.randomBytes ?? randomBytes
    const capability = Buffer.from(random(32)).toString("hex")
    if (!CAPABILITY_PATTERN.test(capability)) {
      throw new AdvocateInvitationRepositoryError("material")
    }

    const emailDigest = crypto.digestEmail(email)
    const encryptedEmail = crypto.encryptRecipientEmail(
      emailDigest.normalizedEmail,
    )
    const encryptedSecret = crypto.encryptSecretPayload(
      JSON.stringify({ version: 1, capability }),
    )
    const capabilityDigest = createHash("sha256")
      .update(capability, "utf8")
      .digest("hex")

    return Object.freeze({
      capability,
      capabilityDigest: `\\x${capabilityDigest}`,
      normalizedEmail: emailDigest.normalizedEmail,
      recipientEmailCiphertext: encryptedEmail.ciphertextRpcBytea,
      recipientEmailHmac: emailDigest.digestRpcBytea,
      secretPayloadCiphertext: encryptedSecret.ciphertextRpcBytea,
      emailNormalizationVersion: emailDigest.normalizationVersion,
      emailHmacKeyVersion: emailDigest.hmacKeyVersion,
      emailEncryptionKeyVersion: encryptedEmail.encryptionKeyVersion,
    })
  } catch (error) {
    if (error instanceof AdvocateInvitationRepositoryError) throw error
    throw new AdvocateInvitationRepositoryError("material")
  }
}

export function createAdvocateInvitationRepository(options: {
  authenticatedClient: SupabaseClient
  serviceClient: SupabaseClient
}) {
  return {
    async loadPending(advocateId: string) {
      const { data, error } = await options.authenticatedClient.rpc(
        "get_advocate_pending_invitations",
        { target_advocate_id: advocateId },
      )
      if (error) throw new AdvocateInvitationRepositoryError("load", error)

      const invitations = parseAdvocatePendingInvitations(data)
      if (invitations === null) {
        throw new AdvocateInvitationRepositoryError("shape")
      }
      return invitations
    },

    async issue(input: {
      advocateId: string
      actingUserId: string
      invitation: AdvocateInvitationIssueInput
      context: AdvocateInvitationAuditContext
      delivery?: PreparedAdvocateInvitationDelivery
    }) {
      const delivery =
        input.delivery ??
        prepareAdvocateInvitationDelivery(input.invitation.email)
      const { data, error } = await options.serviceClient.rpc(
        "issue_advocate_invitation_email",
        {
          target_advocate_id: input.advocateId,
          acting_user_id: input.actingUserId,
          invited_email: delivery.normalizedEmail,
          role_keys: input.invitation.roleKeys,
          idempotency_key: input.invitation.idempotencyKey,
          capability_digest: delivery.capabilityDigest,
          recipient_email_ciphertext: delivery.recipientEmailCiphertext,
          recipient_email_hmac: delivery.recipientEmailHmac,
          secret_payload_ciphertext: delivery.secretPayloadCiphertext,
          email_normalization_version: delivery.emailNormalizationVersion,
          email_hmac_key_version: delivery.emailHmacKeyVersion,
          email_encryption_key_version: delivery.emailEncryptionKeyVersion,
          change_reason: input.invitation.reason,
          request_id: input.context.requestId,
          trace_id: input.context.traceId,
          session_id: input.context.sessionId,
          client_ip: input.context.clientIp,
          user_agent: input.context.userAgent,
        },
      )
      if (error) throw new AdvocateInvitationRepositoryError("issue", error)

      const result = parseIssuedInvitation(data)
      if (result === null) {
        throw new AdvocateInvitationRepositoryError("shape")
      }
      return result
    },

    async revoke(input: {
      advocateId: string
      invitationId: string
      actingUserId: string
      reason: string
      context: AdvocateInvitationAuditContext
    }) {
      const { data, error } = await options.serviceClient.rpc(
        "revoke_advocate_invitation",
        {
          target_advocate_id: input.advocateId,
          target_invitation_id: input.invitationId,
          acting_user_id: input.actingUserId,
          change_reason: input.reason,
          request_id: input.context.requestId,
          trace_id: input.context.traceId,
          session_id: input.context.sessionId,
          client_ip: input.context.clientIp,
          user_agent: input.context.userAgent,
        },
      )
      if (error) throw new AdvocateInvitationRepositoryError("revoke", error)
      if (typeof data !== "boolean") {
        throw new AdvocateInvitationRepositoryError("shape")
      }
      return data
    },
  }
}

export async function loadAdvocatePendingInvitations(
  authenticatedClient: SupabaseClient,
  advocateId: string,
) {
  const { data, error } = await authenticatedClient.rpc(
    "get_advocate_pending_invitations",
    { target_advocate_id: advocateId },
  )
  if (error) throw new AdvocateInvitationRepositoryError("load", error)

  const invitations = parseAdvocatePendingInvitations(data)
  if (invitations === null) {
    throw new AdvocateInvitationRepositoryError("shape")
  }
  return invitations
}

export function invitationRoleLabels(
  roles: readonly AdvocateDelegateRoleKey[],
): string {
  return roles.join(", ")
}
